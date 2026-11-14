const XLSX = require('xlsx');
const { SHIFTS, isDate, naturalCompare } = require('./common');

/**
 * Datesheet import: Excel / CSV rows  ->  validated rows  ->  exam plan.
 * Pure functions (no database) except where a `ctx` of student stats is passed in.
 */

const ALIASES = {
  course: ['course', 'program', 'programme'],
  branch: ['branch', 'department', 'dept', 'stream', 'specialization', 'specialisation'],
  year: ['year', 'yr'],
  semester: ['semester', 'sem'],
  code: ['subjectcode', 'papercode', 'code', 'coursecode'],
  subject: ['subjectname', 'subject', 'papername', 'papertitle', 'subjecttitle'],
  date: ['date', 'examdate', 'dateofexam'],
  shift: ['shift', 'session', 'slot'],
  duration: ['duration', 'hours', 'time'],
};
const flat = (v) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const norm = (v) => flat(v);
const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

const ROMAN = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };
const WORDS = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 };

function parseNumList(v) {
  const s = clean(v);
  if (!s) return { list: [], bad: false };
  const out = [];
  let bad = false;
  for (const tok of s.split(/[\/,&;]| and /i).map((t) => t.trim()).filter(Boolean)) {
    const t = tok.toLowerCase().replace(/\.$/, '');
    let n = NaN;
    if (/^\d+(st|nd|rd|th)?$/.test(t)) n = parseInt(t, 10);
    else if (ROMAN[t]) n = ROMAN[t];
    else if (WORDS[t]) n = WORDS[t];
    else if (/^(year|sem|semester)\s*\d+$/.test(t)) n = parseInt(t.replace(/\D/g, ''), 10);
    if (Number.isInteger(n) && n > 0) out.push(n); else bad = true;
  }
  return { list: [...new Set(out)], bad };
}

const pad = (n) => String(n).padStart(2, '0');
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
function ymd(y, m, d) { const s = `${y}-${pad(m)}-${pad(d)}`; return isDate(s) ? s : ''; }

function parseDate(v) {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return ymd(v.getFullYear(), v.getMonth() + 1, v.getDate()); // SheetJS builds dates so local getters are right
  if (typeof v === 'number' && v > 20000 && v < 80000) { const c = XLSX.SSF.parse_date_code(v); return c ? ymd(c.y, c.m, c.d) : ''; }
  const s = clean(v);
  if (!s) return '';
  let m;
  if ((m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/))) return ymd(+m[1], +m[2], +m[3]);
  if ((m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})/))) { const y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; return ymd(y, +m[2], +m[1]); } // day first (Indian format)
  if ((m = s.match(/^(\d{1,2})[\s-]([A-Za-z]{3,})[\s,-]+(\d{2,4})/))) { const mo = MONTHS[m[2].slice(0, 3).toLowerCase()]; const y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; return mo ? ymd(y, mo, +m[1]) : ''; }
  return '';
}

function parseShift(v) {
  const s = clean(v).toLowerCase();
  if (!s) return '';
  if (s === 'fn' || s.startsWith('mor') || s === 'm' || s.startsWith('forenoon')) return 'Morning';
  if (s === 'an' || s.startsWith('aft') || s === 'a') return 'Afternoon';
  if (s.startsWith('eve') || s === 'e') return 'Evening';
  return '';
}

function parseDuration(v) {
  const s = clean(v).toLowerCase();
  if (!s) return null;
  const m = s.match(/(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|m|min|mins|minute|minutes)?/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const unit = m[2] || (n <= 8 ? 'h' : 'm');
  const min = Math.round(unit.startsWith('h') ? n * 60 : n);
  return min > 0 && min <= 1440 ? min : null;
}

function parseBranches(v) {
  const s = clean(v);
  if (!s || /^(all|-|na|n\/a|nil|none)$/i.test(s)) return [''];
  const parts = s.split(/\s*[,;]\s*|\s+\/\s+/).map((t) => t.trim()).filter(Boolean);
  return [...new Set(parts.map((p) => (/^all$/i.test(p) ? '' : p)))];
}

/** Read a workbook buffer (xlsx / xls / csv) into raw rows. */
function readRows(buffer) {
  let wb;
  try { wb = XLSX.read(buffer, { type: 'buffer', cellDates: true }); } catch { throw new Error('Could not read this file. Use the template.'); }
  const out = [];
  let sheets = 0;
  for (const name of wb.SheetNames) {
    const grid = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '', blankrows: false });
    let h = -1;
    for (let i = 0; i < Math.min(grid.length, 25); i++) {
      const cells = grid[i].map(flat);
      if (cells.includes('date') || cells.includes('examdate')) {
        if (cells.some((c) => ALIASES.subject.includes(c) || ALIASES.code.includes(c))) { h = i; break; }
      }
    }
    if (h < 0) continue;
    sheets++;
    const cols = {};
    grid[h].forEach((cell, idx) => {
      const f = flat(cell);
      for (const [field, names] of Object.entries(ALIASES)) if (cols[field] === undefined && names.includes(f)) cols[field] = idx;
    });
    for (let i = h + 1; i < grid.length; i++) {
      const g = grid[i];
      const get = (f) => (cols[f] === undefined ? '' : g[cols[f]]);
      if (flat(get('date')) === 'date') continue; // repeated header row
      const rec = { row: i + 1, sheet: name };
      for (const f of Object.keys(ALIASES)) rec[f] = get(f);
      if (!clean(rec.subject) && !clean(rec.code) && !clean(rec.date)) continue; // blank line
      out.push(rec);
    }
  }
  if (!sheets) throw new Error('No datesheet table found. The file needs a header row with at least Date and Subject Name (see the template).');
  return out;
}

/** Normalise raw cells into editable string fields. */
function toRows(raw) {
  let lastCourse = '';
  return raw.map((r) => {
    let course = clean(r.course);
    const notes = [];
    if (!course && lastCourse) { course = lastCourse; notes.push('Course copied from the row above.'); }
    if (course) lastCourse = course;
    const date = parseDate(r.date);
    return {
      row: r.row,
      course,
      branch: clean(r.branch),
      year: clean(r.year),
      semester: clean(r.semester),
      code: clean(r.code),
      subject: clean(r.subject),
      date: date || clean(r.date instanceof Date ? '' : r.date),
      shift: parseShift(r.shift) || clean(r.shift),
      durationMin: parseDuration(r.duration),
      notes,
    };
  });
}

/** Validate one row; returns { errors, parsed } */
function checkRow(r) {
  const errors = [];
  if (!clean(r.course)) errors.push('Course is missing');
  if (!clean(r.subject)) errors.push('Subject name is missing');
  const y = parseNumList(r.year);
  const s = parseNumList(r.semester);
  if (!y.list.length || y.bad) errors.push('Year not understood (use 1-8, or I-VIII)');
  if (s.bad) errors.push('Semester not understood');
  if (y.list.some((n) => n > 8)) errors.push('Year must be 1-8');
  if (s.list.some((n) => n > 16)) errors.push('Semester must be 1-16');
  let pairs = [];
  if (!errors.length) {
    if (!s.list.length) pairs = y.list.map((yy) => [yy, null]);
    else if (y.list.length === s.list.length) pairs = y.list.map((yy, i) => [yy, s.list[i]]);
    else if (y.list.length === 1) pairs = s.list.map((ss) => [y.list[0], ss]);
    else if (s.list.length === 1) pairs = y.list.map((yy) => [yy, s.list[0]]);
    else errors.push('Year and semester lists do not line up (e.g. II/IV with III/VII)');
  }
  const date = isDate(r.date) ? r.date : parseDate(r.date);
  if (!date) errors.push('Date not understood (use DD-MM-YYYY)');
  const shift = SHIFTS.includes(r.shift) ? r.shift : parseShift(r.shift);
  if (!shift) errors.push('Shift must be Morning / Afternoon (M / A)');
  return { errors, parsed: { pairs, date, shift, branches: parseBranches(r.branch), durationMin: r.durationMin ?? null } };
}

/** Match sheet course/branch names to what exists in the Student collection. */
function buildMatcher(studentPairs, courseMap = {}, branchMap = {}) {
  const courses = [...new Set(studentPairs.map((p) => p.course))];
  const branchesOf = (c) => [...new Set(studentPairs.filter((p) => p.course === c).map((p) => p.branch))];
  const byNorm = new Map(courses.map((c) => [norm(c), c]));

  function autoCourses(sheet) {
    const n = norm(sheet);
    if (byNorm.has(n)) return [byNorm.get(n)];
    const parts = sheet.split(/\s*(?:&|\/|,| and )\s*/i).map((p) => norm(p)).filter(Boolean);
    const hit = parts.map((p) => byNorm.get(p)).filter(Boolean);
    if (hit.length) return [...new Set(hit)];
    const loose = courses.filter((c) => norm(c).includes(n) || n.includes(norm(c)));
    return loose.length === 1 ? loose : [];
  }
  const resolveCourses = (sheet) => {
    const o = courseMap[sheet];
    if (Array.isArray(o) && o.length) return { list: o, found: o.every((c) => courses.includes(c)) };
    if (typeof o === 'string' && o) return { list: [o], found: courses.includes(o) };
    const auto = autoCourses(sheet);
    return auto.length ? { list: auto, found: true } : { list: [sheet], found: false };
  };
  const resolveBranch = (sheetCourse, sheetBranch, realCourse) => {
    if (sheetBranch === '') return { name: '', found: true };
    const o = branchMap[`${sheetCourse}|${sheetBranch}`];
    if (typeof o === 'string') return { name: o, found: o === '' || branchesOf(realCourse).includes(o) };
    const list = branchesOf(realCourse);
    const n = norm(sheetBranch);
    const exact = list.find((b) => norm(b) === n);
    if (exact) return { name: exact, found: true };
    const loose = list.filter((b) => norm(b).includes(n) || n.includes(norm(b)));
    if (loose.length === 1 && n.length > 1) return { name: loose[0], found: true };
    return { name: sheetBranch, found: false };
  };
  return { courses, branchesOf, resolveCourses, resolveBranch };
}

/** Distinct sheet courses / branches with how they were matched (for the mapping panel). */
function describeMaps(rows, matcher) {
  const cMap = new Map();
  const bMap = new Map();
  for (const r of rows) {
    if (!r.course) continue;
    if (!cMap.has(r.course)) { const x = matcher.resolveCourses(r.course); cMap.set(r.course, { sheet: r.course, matched: x.list, found: x.found, rows: 0 }); }
    cMap.get(r.course).rows++;
    for (const b of parseBranches(r.branch)) {
      if (b === '') continue;
      const k = `${r.course}|${b}`;
      if (!bMap.has(k)) {
        const x = matcher.resolveCourses(r.course);
        const res = x.list.map((c) => matcher.resolveBranch(r.course, b, c));
        bMap.set(k, { course: r.course, sheet: b, matched: res[0]?.name ?? b, found: res.every((q) => q.found), rows: 0 });
      }
      bMap.get(k).rows++;
    }
  }
  const sort = (a, b) => naturalCompare(a.sheet, b.sheet);
  return { courses: [...cMap.values()].sort(sort), branches: [...bMap.values()].sort((a, b) => naturalCompare(a.course + a.sheet, b.course + b.sheet)), studentCourses: matcher.courses.sort(naturalCompare) };
}

/**
 * Turn validated rows into one exam per (course, year, semester).
 * studentCounts: Map `${course}|${year}|${semester}|${branch}` -> n  (optional, for warnings)
 */
function buildPlan(rows, matcher, studentCounts) {
  const issues = [];
  const exams = new Map();
  let accepted = 0;
  for (const r of rows) {
    const { errors, parsed } = checkRow(r);
    if (errors.length) { for (const m of errors) issues.push({ row: r.row, level: 'error', message: m }); continue; }
    accepted++;
    const cs = matcher.resolveCourses(r.course);
    if (!cs.found) issues.push({ row: r.row, level: 'warn', message: `Course "${r.course}" matches no student course` });
    for (const course of cs.list) for (const [year, sem] of parsed.pairs) for (const sheetBranch of parsed.branches) {
      const b = matcher.resolveBranch(r.course, sheetBranch, course);
      if (!b.found && sheetBranch) issues.push({ row: r.row, level: 'warn', message: `Branch "${sheetBranch}" not found under ${course}` });
      const key = `${course}|${year}|${sem ?? ''}`;
      if (!exams.has(key)) exams.set(key, { course, year, semester: sem, entries: [] });
      const ex = exams.get(key);
      const slot = ex.entries.filter((e) => e.date === parsed.date && e.shift === parsed.shift);
      const entry = { date: parsed.date, shift: parsed.shift, subject: r.subject, code: r.code, branch: b.name, durationMin: parsed.durationMin, row: r.row };
      if (slot.some((e) => e.branch === entry.branch)) { issues.push({ row: r.row, level: 'warn', message: `Duplicate of row ${slot.find((e) => e.branch === entry.branch).row} (same class, date and shift) - skipped` }); continue; }
      if (slot.some((e) => e.branch === '' || entry.branch === '')) { issues.push({ row: r.row, level: 'error', message: `Clashes with row ${slot[0].row}: a whole-course paper and a branch paper on the same date and shift` }); continue; }
      ex.entries.push(entry);
    }
  }
  const list = [...exams.values()].sort((a, b) => naturalCompare(a.course, b.course) || a.year - b.year || (a.semester || 0) - (b.semester || 0));
  for (const ex of list) {
    ex.entries.sort((a, b) => a.date.localeCompare(b.date) || SHIFTS.indexOf(a.shift) - SHIFTS.indexOf(b.shift));
    if (studentCounts) {
      for (const e of ex.entries) {
        let n = 0;
        for (const [k, v] of studentCounts) {
          const [c, y, s, br] = k.split('|');
          if (c === ex.course && +y === ex.year && (!ex.semester || +s === ex.semester) && (!e.branch || br === e.branch)) n += v;
        }
        e.eligible = n;
      }
    }
  }
  return { exams: list, issues, accepted };
}

module.exports = { readRows, toRows, checkRow, buildMatcher, describeMaps, buildPlan, parseDate, parseShift, parseDuration, parseNumList, parseBranches, norm };
