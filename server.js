const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());

const DATA_FILE = path.join(__dirname, 'shared-tasks.json');

function readData() {
	try {
		return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
	} catch {
		return { classes: {} };
	}
}

function writeData(data) {
	fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.get('/api/shared-tasks', (req, res) => {
	const classId = String(req.query.classId || '').trim();
	if (!classId) return res.status(400).json({ error: 'classId required' });
	const store = readData();
	const tasks = store.classes[classId]?.tasks || [];
	res.json({ classId, tasks });
});

app.post('/api/shared-tasks', (req, res) => {
	const { classId, task } = req.body || {};
	if (!classId || !task || !task.title) return res.status(400).json({ error: 'classId and task.title required' });
	const store = readData();
	if (!store.classes[classId]) store.classes[classId] = { tasks: [] };
	store.classes[classId].tasks.push({
		title: String(task.title),
		due: Number(task.due) || Date.now(),
		importance: Number(task.importance) || 5,
		notes: String(task.notes || ''),
		recurrence: String(task.recurrence || 'none'),
		tags: Array.isArray(task.tags) ? task.tags : []
	});
	writeData(store);
	res.json({ ok: true });
});

app.listen(PORT, () => {
	console.log(`Shared tasks API listening on http://localhost:${PORT}`);
});