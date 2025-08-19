// Mobile-specific JavaScript for Task Manager

class MobileTaskManager {
    constructor() {
        this.tasks = [];
        this.filterMode = 'all';
        this.searchQuery = '';

        this.init();
    }

    init() {
        this.loadTasks();
        this.setupEventListeners();
        this.updateStats();
        this.renderTasks();
        this.setupModals();
        this.updateProgress();
    }

    setupEventListeners() {
        // Task input
        const taskInput = document.getElementById('taskInput');
        const addTaskBtn = document.getElementById('addTaskBtn');
        const quickAddBtn = document.getElementById('quickAddBtn');

        taskInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.openAddTaskModal();
            }
        });

        addTaskBtn.addEventListener('click', () => this.openAddTaskModal());
        quickAddBtn.addEventListener('click', () => this.quickAddTask());

        // Filters
        const filterSelect = document.getElementById('filterSelect');
        const searchInput = document.getElementById('searchInput');

        filterSelect.addEventListener('change', (e) => {
            this.filterMode = e.target.value;
            this.renderTasks();
            this.updateProgress();
        });

        searchInput.addEventListener('input', (e) => {
            this.searchQuery = e.target.value.toLowerCase();
            this.renderTasks();
        });

        // Header buttons
        document.getElementById('helpBtn').addEventListener('click', () => {
            this.showModal('helpModal');
        });
        document.getElementById('manualBtn').addEventListener('click', () => {
            const modal = document.getElementById('manualModal');
            if (modal) modal.classList.add('active');
        });

        // View toggle: switch to desktop and remember preference
        const viewToggle = document.getElementById('viewToggleBtn');
        viewToggle?.addEventListener('click', () => {
            try { localStorage.setItem('preferDesktop', 'true'); } catch {}
            window.location.href = 'index.html';
        });

        // Touch optimizations
        this.setupTouchOptimizations();
    }

    setupTouchOptimizations() {
        // Prevent zoom on double tap
        let lastTouchEnd = 0;
        document.addEventListener('touchend', (event) => {
            const now = (new Date()).getTime();
            if (now - lastTouchEnd <= 300) {
                event.preventDefault();
            }
            lastTouchEnd = now;
        }, false);

        // Improve touch scrolling
        document.addEventListener('touchstart', () => {}, { passive: true });
        document.addEventListener('touchmove', () => {}, { passive: true });

        // Prevent zoom on input focus
        const inputs = document.querySelectorAll('input, textarea');
        inputs.forEach(input => {
            input.addEventListener('focus', () => {
                setTimeout(() => {
                    input.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }, 300);
            });
        });
    }

    // Open modal to add a full task (desktop-like)
    openAddTaskModal() {
        const modal = document.getElementById('addTaskModal');
        const title = document.getElementById('mTaskTitle');
        const due = document.getElementById('mTaskDue');
        const importance = document.getElementById('mTaskImportance');
        const importanceValue = document.getElementById('mImportanceValue');
        const notes = document.getElementById('mTaskNotes');
        const tags = document.getElementById('mTaskTags');

        // Reset defaults
        title.value = '';
        const now = new Date();
        now.setMinutes(now.getMinutes() + 60);
        const p = (n) => String(n).padStart(2, '0');
        due.value = `${now.getFullYear()}-${p(now.getMonth()+1)}-${p(now.getDate())}T${p(now.getHours())}:${p(now.getMinutes())}`;
        importance.value = 5;
        importanceValue.textContent = '5';
        notes.value = '';
        tags.value = '';

        modal.classList.add('active');
        setTimeout(() => title.focus(), 50);
    }

    // Save task from modal
    bindAddTaskModalEvents() {
        const modal = document.getElementById('addTaskModal');
        const closeBtn = document.getElementById('mCloseAddTask');
        const cancelBtn = document.getElementById('mCancelTask');
        const form = document.getElementById('mTaskForm');
        const importance = document.getElementById('mTaskImportance');
        const importanceValue = document.getElementById('mImportanceValue');

        importance.addEventListener('input', () => {
            importanceValue.textContent = String(importance.value);
        });

        const closeModal = () => modal.classList.remove('active');
        closeBtn.addEventListener('click', closeModal);
        cancelBtn.addEventListener('click', closeModal);
        modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const title = document.getElementById('mTaskTitle').value.trim();
            const dueStr = document.getElementById('mTaskDue').value;
            const importanceVal = Number(document.getElementById('mTaskImportance').value);
            const notes = document.getElementById('mTaskNotes').value.trim();
            const tagsStr = document.getElementById('mTaskTags').value.trim();

            if (!title || !dueStr) return;
            const due = new Date(dueStr).getTime();
            const tags = tagsStr ? tagsStr.split(',').map(s => s.trim()).filter(Boolean) : [];

            const task = {
                id: Date.now(),
                title,
                due,
                importance: Math.min(10, Math.max(1, importanceVal || 5)),
                notes,
                tags,
                completed: false,
                createdAt: Date.now()
            };

            // Save to local storage (mobile storage)
            this.tasks.push(task);
            // Sort by due date (active first, earliest due first)
            this.tasks.sort((a, b) => (a.completed - b.completed) || (a.due - b.due));
            this.saveTasks();
            this.renderTasks();
            this.updateStats();
            this.updateProgress();
            this.showToast(`Added "${task.title}"`);
            closeModal();
        });
    }

    quickAddTask() {
        const taskInput = document.getElementById('taskInput');
        const text = taskInput.value.trim();
        
        if (text) {
            const task = {
                id: Date.now(),
                title: text,
                text: text,
                completed: false,
                createdAt: Date.now(),
                due: Date.now() + 24*60*60*1000,
                importance: 5,
                notes: '',
                tags: []
            };
            
            this.tasks.unshift(task);
            this.saveTasks();
            this.updateStats();
            this.renderTasks();
            this.updateProgress();
            
            taskInput.value = '';
            taskInput.focus();
            
            this.showToast('Quick task added!');
        }
    }

    toggleTask(id) {
        const task = this.tasks.find(t => t.id === id);
        if (task) {
            task.completed = !task.completed;
            this.saveTasks();
            this.updateStats();
            this.renderTasks();
            this.updateProgress();
        }
    }

    deleteTask(id) {
        this.tasks = this.tasks.filter(t => t.id !== id);
        this.saveTasks();
        this.updateStats();
        this.renderTasks();
        this.updateProgress();
        this.showToast('Task deleted');
    }

    renderTasks() {
        const taskList = document.getElementById('taskList');
        const taskCount = document.getElementById('taskCount');
        
        let filteredTasks = this.tasks.map(t => ({
            // Normalize for older saved entries
            id: t.id,
            title: t.title || t.text,
            text: t.title || t.text,
            completed: !!t.completed,
            due: t.due || (Date.now() + 24*60*60*1000),
            importance: typeof t.importance === 'number' ? t.importance : 5,
        }));
        
        // Apply filter
        if (this.filterMode === 'pending') {
            filteredTasks = filteredTasks.filter(t => !t.completed);
        } else if (this.filterMode === 'completed') {
            filteredTasks = filteredTasks.filter(t => t.completed);
        }
        
        // Apply search
        if (this.searchQuery) {
            filteredTasks = filteredTasks.filter(t => 
                (t.text || '').toLowerCase().includes(this.searchQuery)
            );
        }
        
        taskList.innerHTML = '';
        taskCount.textContent = `${filteredTasks.length} task${filteredTasks.length !== 1 ? 's' : ''}`;
        
        filteredTasks.forEach(task => {
            const taskElement = this.createTaskElement(task);
            taskList.appendChild(taskElement);
        });
    }

    createTaskElement(task) {
        const taskDiv = document.createElement('div');
        taskDiv.className = `task-item ${task.completed ? 'completed' : ''}`;
        
        const hue = Math.round(120 - ((Math.min(10, Math.max(1, task.importance)) - 1) / 9) * 120);
        taskDiv.innerHTML = `
            <div class="task-content">
                <input type="checkbox" class="task-checkbox" ${task.completed ? 'checked' : ''}>
                <div class="task-text">
                    <div class="title-row">
                        <span class="dot" style="background-color:hsl(${hue} 85% 50%)"></span>
                        <span>${this.escapeHtml(task.text)}</span>
                    </div>
                </div>
            </div>
            <div class="task-actions">
                <button class="btn btn-secondary delete-btn">Delete</button>
            </div>
        `;
        
        // Event listeners
        const checkbox = taskDiv.querySelector('.task-checkbox');
        const deleteBtn = taskDiv.querySelector('.delete-btn');
        
        checkbox.addEventListener('change', () => {
            this.toggleTask(task.id);
        });
        
        deleteBtn.addEventListener('click', () => {
            this.deleteTask(task.id);
        });
        
        return taskDiv;
    }

    updateStats() {
        const totalTasks = this.tasks.length;
        const completedTasks = this.tasks.filter(t => t.completed).length;
        const pendingTasks = totalTasks - completedTasks;
        
        // Calculate streak (simplified - just count consecutive days with tasks)
        const streakDays = this.calculateStreak();
        
        document.getElementById('totalTasks').textContent = totalTasks;
        document.getElementById('completedTasks').textContent = completedTasks;
        document.getElementById('pendingTasks').textContent = pendingTasks;
        document.getElementById('streakDays').textContent = streakDays;
    }

    updateProgress() {
        const progressFillEl = document.getElementById('progressFill');
        const progressPctEl = document.getElementById('progressPct');
        if (!progressFillEl || !progressPctEl) return;
        const total = this.tasks.length;
        const completed = this.tasks.filter(t => t.completed).length;
        const pct = total === 0 ? 0 : Math.round((completed / total) * 100);
        progressFillEl.style.transform = `scaleX(${pct/100})`;
        progressPctEl.textContent = pct + '%';
    }

    calculateStreak() {
        // Simple streak calculation - count days with tasks in the last 7 days
        const today = new Date();
        const last7Days = [];
        
        for (let i = 0; i < 7; i++) {
            const date = new Date(today);
            date.setDate(date.getDate() - i);
            last7Days.push(date.toDateString());
        }
        
        let streak = 0;
        for (let i = 0; i < last7Days.length; i++) {
            const dayTasks = this.tasks.filter(task => {
                const taskDate = new Date(task.createdAt).toDateString();
                return taskDate === last7Days[i];
            });
            
            if (dayTasks.length > 0) {
                streak++;
            } else {
                break;
            }
        }
        
        return streak;
    }

    setupModals() {
        document.getElementById('closeHelp').addEventListener('click', () => {
            this.hideModal('helpModal');
        });
        const closeManual = document.getElementById('closeManual');
        closeManual?.addEventListener('click', () => this.hideModal('manualModal'));

        // Close on backdrop click
        document.querySelectorAll('.modal').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    modal.classList.remove('active');
                }
            });
        });

        // Bind add task modal controls
        this.bindAddTaskModalEvents();
    }

    showModal(modalId) {
        const modal = document.getElementById(modalId);
        modal.classList.add('active');
    }

    hideModal(modalId) {
        const modal = document.getElementById(modalId);
        modal.classList.remove('active');
    }

    // Settings removed on mobile

    saveTasks() {
        localStorage.setItem('mobileTasks', JSON.stringify(this.tasks));
    }

    loadTasks() {
        const saved = localStorage.getItem('mobileTasks');
        this.tasks = saved ? JSON.parse(saved) : [];
    }

    showToast(message) {
        // Create toast notification
        const toast = document.createElement('div');
        toast.style.cssText = `
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(59, 130, 246, 0.9);
            color: white;
            padding: 12px 20px;
            border-radius: 8px;
            font-size: 14px;
            z-index: 3000;
            backdrop-filter: blur(10px);
        `;
        toast.textContent = message;
        
        document.body.appendChild(toast);
        
        setTimeout(() => {
            toast.remove();
        }, 3000);
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new MobileTaskManager();
});