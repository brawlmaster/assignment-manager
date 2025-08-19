// Mobile-specific JavaScript for Task Manager

class MobileTaskManager {
    constructor() {
        this.tasks = [];
        this.filterMode = 'all';
        this.searchQuery = '';
        this.isPlaying = false;
        this.isMinimized = false;
        
        this.init();
    }

    init() {
        this.loadTasks();
        this.setupEventListeners();
        this.updateStats();
        this.renderTasks();
        this.setupMusicPlayer();
        this.setupModals();
    }

    setupEventListeners() {
        // Task input
        const taskInput = document.getElementById('taskInput');
        const addTaskBtn = document.getElementById('addTaskBtn');
        const quickAddBtn = document.getElementById('quickAddBtn');

        taskInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.addTask();
            }
        });

        addTaskBtn.addEventListener('click', () => this.addTask());
        quickAddBtn.addEventListener('click', () => this.quickAddTask());

        // Filters
        const filterSelect = document.getElementById('filterSelect');
        const searchInput = document.getElementById('searchInput');

        filterSelect.addEventListener('change', (e) => {
            this.filterMode = e.target.value;
            this.renderTasks();
        });

        searchInput.addEventListener('input', (e) => {
            this.searchQuery = e.target.value.toLowerCase();
            this.renderTasks();
        });

        // Header buttons
        document.getElementById('settingsBtn').addEventListener('click', () => {
            this.showModal('settingsModal');
        });

        document.getElementById('helpBtn').addEventListener('click', () => {
            this.showModal('helpModal');
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey || e.metaKey) {
                switch (e.key) {
                    case '/':
                        e.preventDefault();
                        this.showModal('settingsModal');
                        break;
                    case 'k':
                        e.preventDefault();
                        searchInput.focus();
                        break;
                }
            } else if (e.key === ' ') {
                e.preventDefault();
                this.toggleMusic();
            }
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

    addTask() {
        const taskInput = document.getElementById('taskInput');
        const text = taskInput.value.trim();
        
        if (text) {
            const task = {
                id: Date.now(),
                text: text,
                completed: false,
                createdAt: new Date().toISOString()
            };
            
            this.tasks.unshift(task);
            this.saveTasks();
            this.updateStats();
            this.renderTasks();
            
            taskInput.value = '';
            taskInput.focus();
            
            this.showToast('Task added successfully!');
        }
    }

    quickAddTask() {
        const taskInput = document.getElementById('taskInput');
        const text = taskInput.value.trim();
        
        if (text) {
            const task = {
                id: Date.now(),
                text: text,
                completed: false,
                createdAt: new Date().toISOString(),
                quickAdd: true
            };
            
            this.tasks.unshift(task);
            this.saveTasks();
            this.updateStats();
            this.renderTasks();
            
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
        }
    }

    deleteTask(id) {
        this.tasks = this.tasks.filter(t => t.id !== id);
        this.saveTasks();
        this.updateStats();
        this.renderTasks();
        this.showToast('Task deleted');
    }

    renderTasks() {
        const taskList = document.getElementById('taskList');
        const taskCount = document.getElementById('taskCount');
        
        let filteredTasks = this.tasks;
        
        // Apply filter
        if (this.filterMode === 'pending') {
            filteredTasks = filteredTasks.filter(t => !t.completed);
        } else if (this.filterMode === 'completed') {
            filteredTasks = filteredTasks.filter(t => t.completed);
        }
        
        // Apply search
        if (this.searchQuery) {
            filteredTasks = filteredTasks.filter(t => 
                t.text.toLowerCase().includes(this.searchQuery)
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
        
        taskDiv.innerHTML = `
            <div class="task-content">
                <input type="checkbox" class="task-checkbox" ${task.completed ? 'checked' : ''}>
                <div class="task-text">${this.escapeHtml(task.text)}</div>
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

    setupMusicPlayer() {
        const audio = document.getElementById('backgroundMusic');
        const playPauseBtn = document.getElementById('playPauseBtn');
        const minimizeBtn = document.getElementById('minimizeBtn');
        const volumeSlider = document.getElementById('volumeSlider');
        const musicPlayer = document.getElementById('musicPlayer');

        // Set initial volume
        audio.volume = 0.5;

        playPauseBtn.addEventListener('click', () => {
            this.toggleMusic();
        });

        minimizeBtn.addEventListener('click', () => {
            this.toggleMinimize();
        });

        volumeSlider.addEventListener('input', (e) => {
            audio.volume = e.target.value / 100;
        });

        audio.addEventListener('play', () => {
            this.isPlaying = true;
            playPauseBtn.textContent = '⏸️';
        });

        audio.addEventListener('pause', () => {
            this.isPlaying = false;
            playPauseBtn.textContent = '▶️';
        });

        audio.addEventListener('ended', () => {
            this.isPlaying = false;
            playPauseBtn.textContent = '▶️';
        });
    }

    toggleMusic() {
        const audio = document.getElementById('backgroundMusic');
        if (this.isPlaying) {
            audio.pause();
        } else {
            audio.play().catch(e => {
                console.log('Audio play failed:', e);
                this.showToast('Click play to start music');
            });
        }
    }

    toggleMinimize() {
        const musicPlayer = document.getElementById('musicPlayer');
        const minimizeBtn = document.getElementById('minimizeBtn');
        
        this.isMinimized = !this.isMinimized;
        
        if (this.isMinimized) {
            musicPlayer.classList.add('minimized');
            minimizeBtn.textContent = '➕';
        } else {
            musicPlayer.classList.remove('minimized');
            minimizeBtn.textContent = '➖';
        }
    }

    setupModals() {
        // Close buttons
        document.getElementById('closeSettings').addEventListener('click', () => {
            this.hideModal('settingsModal');
        });

        document.getElementById('closeHelp').addEventListener('click', () => {
            this.hideModal('helpModal');
        });

        // Close on backdrop click
        document.querySelectorAll('.modal').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    modal.classList.remove('active');
                }
            });
        });

        // Settings checkboxes
        const settingCheckboxes = document.querySelectorAll('.setting-item input[type="checkbox"]');
        settingCheckboxes.forEach(checkbox => {
            checkbox.addEventListener('change', () => {
                this.saveSettings();
            });
        });

        this.loadSettings();
    }

    showModal(modalId) {
        const modal = document.getElementById(modalId);
        modal.classList.add('active');
    }

    hideModal(modalId) {
        const modal = document.getElementById(modalId);
        modal.classList.remove('active');
    }

    saveSettings() {
        const settings = {};
        document.querySelectorAll('.setting-item input[type="checkbox"]').forEach(checkbox => {
            settings[checkbox.id] = checkbox.checked;
        });
        localStorage.setItem('mobileSettings', JSON.stringify(settings));
    }

    loadSettings() {
        const settings = JSON.parse(localStorage.getItem('mobileSettings') || '{}');
        Object.keys(settings).forEach(key => {
            const checkbox = document.getElementById(key);
            if (checkbox) {
                checkbox.checked = settings[key];
            }
        });
    }

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