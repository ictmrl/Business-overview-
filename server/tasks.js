// Tasks with due dates and optional repeats. Stored in the dashboard's state
// file (on the Railway volume when hosted). Scheduling rules live in
// public/tasks-core.js, shared with the browser.
import crypto from 'node:crypto';
import express from 'express';
import { getState, save, getSettings } from './store.js';
import { REPEATS, isDate, nextDueAfterDone, summarise, todayIn } from '../public/tasks-core.js';

export const tasksToday = () => todayIn(getSettings().general.timezone || 'Europe/London');
const list = () => (getState().tasks ||= []);
export const tasksSummary = () => summarise(list().filter((t) => !t.done), tasksToday());

function clean(body, existing = {}) {
  const out = {};
  if ('title' in body || !existing.id) {
    const title = String(body.title ?? '').trim();
    if (!title) throw new Error('Give the task a name');
    out.title = title.slice(0, 200);
  }
  if ('notes' in body) out.notes = String(body.notes ?? '').slice(0, 2000);
  if ('dueDate' in body || !existing.id) {
    if (!isDate(body.dueDate)) throw new Error('Choose a valid due date');
    out.dueDate = body.dueDate;
    out.anchorDay = Number(body.dueDate.slice(8, 10)); // monthly repeats return to this day
  }
  if ('repeat' in body || !existing.id) {
    const repeat = body.repeat || 'none';
    if (!(repeat in REPEATS)) throw new Error('Unknown repeat');
    out.repeat = repeat;
  }
  return out;
}

export function tasksRouter(onChange = () => {}) {
  const r = express.Router();
  const changed = () => { save(); onChange(tasksSummary()); };

  r.get('/', (req, res) => {
    const today = tasksToday();
    res.json({ today, tasks: list(), summary: summarise(list().filter((t) => !t.done), today) });
  });

  r.post('/', (req, res) => {
    try {
      const t = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), done: false, history: [], notes: '', ...clean(req.body || {}) };
      list().push(t);
      changed();
      res.json({ ok: true, task: t });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  r.put('/:id', (req, res) => {
    const t = list().find((x) => x.id === req.params.id);
    if (!t) return res.status(404).json({ error: 'Task not found' });
    try { Object.assign(t, clean(req.body || {}, t), { updatedAt: new Date().toISOString() }); changed(); res.json({ ok: true, task: t }); }
    catch (e) { res.status(400).json({ error: e.message }); }
  });

  r.delete('/:id', (req, res) => {
    const tasks = list(), i = tasks.findIndex((x) => x.id === req.params.id);
    if (i < 0) return res.status(404).json({ error: 'Task not found' });
    tasks.splice(i, 1);
    changed();
    res.json({ ok: true });
  });

  // Mark done: repeating tasks move to their next date; one-off tasks are completed.
  r.post('/:id/done', (req, res) => {
    const t = list().find((x) => x.id === req.params.id);
    if (!t) return res.status(404).json({ error: 'Task not found' });
    if (t.done) return res.status(409).json({ error: 'Already completed' });
    const today = tasksToday();
    (t.history ||= []).push({ dueDate: t.dueDate, doneOn: today });
    t.history = t.history.slice(-50);
    t.lastDone = today;
    const next = nextDueAfterDone(t, today);
    if (next) t.dueDate = next; else { t.done = true; t.doneOn = today; }
    changed();
    res.json({ ok: true, task: t, next });
  });

  // Undo the last "done" (restores the previous due date, or reopens a one-off task).
  r.post('/:id/undo', (req, res) => {
    const t = list().find((x) => x.id === req.params.id);
    const last = t?.history?.at(-1);
    if (!t || !last) return res.status(400).json({ error: 'Nothing to undo' });
    t.history.pop();
    t.dueDate = last.dueDate;
    t.done = false; delete t.doneOn;
    t.lastDone = t.history.at(-1)?.doneOn || null;
    changed();
    res.json({ ok: true, task: t });
  });

  return r;
}
