import { api } from './api.js';
import { RaceViewer } from './viewer.js';
import { UI } from './ui.js';

const GOLDEN_COLOR = '#eab308';
const USER_COLOR = '#3b82f6';

class App {
    constructor() {
        this.state = {
            circuits: [],
            selectedCircuit: null,
            vehicles: [],
            lapsByVehicle: {},
            selectedVehicle: null,
            selectedLaps: [],
            goldenLap: null,
            isPlaying: false,
            playbackSpeed: 1,
            currentTime: 0,
            totalTime: 0,
            lastFrame: 0,
            analysisData: null
        };
        this.ui = new UI();
        this.viewer = null;

        this._bindEvents();
        this._loadCircuits();
    }

    _bindEvents() {
        document.getElementById('launch-btn').addEventListener('click', () => this.launchReplay());

        const playBtn = document.getElementById('btn-play');
        playBtn.addEventListener('click', () => this.togglePlay());

        document.getElementById('btn-restart').addEventListener('click', () => this.restart());
        document.getElementById('btn-exit').addEventListener('click', () => window.location.reload());

        const speedSelect = document.getElementById('speed-select');
        if (speedSelect) {
            speedSelect.addEventListener('change', e => {
                this.state.playbackSpeed = parseFloat(e.target.value);
            });
        }

        // Analysis mode buttons
        document.querySelectorAll('.analysis-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.analysis-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                if (this.viewer) {
                    this.viewer.showAnalysis(btn.dataset.mode || 'lap');
                }
            });
        });
    }

    async _loadCircuits() {
        try {
            const circuits = await api.getCircuits();
            this.state.circuits = circuits;
            const select = document.getElementById('circuit-select');

            select.innerHTML = '<option value="" disabled selected>Select a circuit...</option>';

            circuits.forEach(item => {
                const option = document.createElement('option');
                option.value = item.id || item;
                option.textContent = item.name || item.id || item;
                select.appendChild(option);
            });

            select.addEventListener('change', e => this.onCircuitChange(e.target.value));
        } catch (err) {
            console.error('Failed to load circuits', err);
        }
    }

    async onCircuitChange(circuitId) {
        this.state.selectedCircuit = circuitId;

        document.getElementById('vehicle-grid').innerHTML = `
            <div class="placeholder-state">
                <i data-lucide="loader-2" class="spin"></i>
                <span>Loading vehicles...</span>
            </div>`;
        lucide.createIcons();

        try {
            const payload = await api.getReplaySetup(circuitId);
            this.state.goldenLap = payload.golden_lap;
            this.state.vehicles = payload.vehicles || [];

            const goldenInfo = document.getElementById('golden-info');
            goldenInfo.classList.remove('hidden');
            document.getElementById('golden-name').textContent = `Chassis ${payload.golden_lap.chassis}`;
            document.getElementById('golden-time').textContent = payload.golden_lap.formatted_time;

            this.renderVehicles();
        } catch (err) {
            console.error('Failed to load replay setup', err);
            document.getElementById('vehicle-grid').innerHTML = '<div class="placeholder-state text-red">Error loading vehicles.</div>';
        }
    }

    renderVehicles() {
        const grid = document.getElementById('vehicle-grid');
        grid.innerHTML = '';

        if (this.state.vehicles.length === 0) {
            grid.innerHTML = '<div class="placeholder-state">No vehicles found.</div>';
            return;
        }

        this.state.vehicles.forEach(vehicle => {
            const card = document.createElement('div');
            card.className = 'vehicle-card';
            card.innerHTML = `
                <div class="vehicle-icon">🏎️</div>
                <div class="vehicle-info">
                    <strong>#${vehicle.car_number}</strong>
                    <span>Chassis ${vehicle.chassis}</span>
                    <span style="display:block; margin-top:4px; font-size:0.75rem; color:var(--text-muted)">${vehicle.total_laps} Laps</span>
                </div>
            `;

            card.addEventListener('click', () => this.onVehicleSelect(vehicle, card));
            grid.appendChild(card);
        });
    }

    async onVehicleSelect(vehicle, cardElement) {
        this.state.selectedVehicle = vehicle;

        document.querySelectorAll('.vehicle-card').forEach(p => p.classList.remove('selected'));
        cardElement.classList.add('selected');

        const lapGrid = document.getElementById('lap-grid');
        lapGrid.innerHTML = `
            <div class="placeholder-state">
                <i data-lucide="loader-2" class="spin"></i>
                <span>Loading laps...</span>
            </div>`;
        lucide.createIcons();

        const key = `${vehicle.chassis}_${vehicle.car_number}`;
        if (!this.state.lapsByVehicle[key]) {
            const res = await api.getVehicleLaps(this.state.selectedCircuit, vehicle.chassis, vehicle.car_number);
            this.state.lapsByVehicle[key] = res.laps || [];
        }
        this.renderLaps(key);
    }

    renderLaps(key) {
        const laps = this.state.lapsByVehicle[key] || [];
        const grid = document.getElementById('lap-grid');
        grid.innerHTML = '';

        if (laps.length === 0) {
            grid.innerHTML = '<div class="placeholder-state">No valid laps.</div>';
            return;
        }

        laps.forEach(lap => {
            const item = document.createElement('div');
            item.className = 'lap-item';

            const isGolden = this.state.goldenLap &&
                this.state.goldenLap.lap === lap.lap_number &&
                this.state.goldenLap.car_number === this.state.selectedVehicle.car_number;

            item.innerHTML = `
                <span class="lap-number">Lap ${lap.lap_number} ${isGolden ? '👑' : ''}</span>
                <span class="lap-time">${lap.formatted_time}</span>
            `;

            item.addEventListener('click', () => this.toggleLap(key, lap, item));
            grid.appendChild(item);
        });
    }

    toggleLap(key, lap, itemElement) {
        document.querySelectorAll('.lap-item').forEach(p => p.classList.remove('selected'));
        this.state.selectedLaps = [];

        const vehicle = this.state.selectedVehicle;
        const color = USER_COLOR;

        this.state.selectedLaps = [{
            key: `${key}_${lap.lap_number}`,
            chassis: vehicle.chassis,
            car_number: vehicle.car_number,
            lap: lap.lap_number,
            name: `Lap ${lap.lap_number}`,
            color
        }];

        itemElement.classList.add('selected');
        this.renderSelectedLaps();
    }

    renderSelectedLaps() {
        const container = document.getElementById('selected-laps');
        container.innerHTML = '';

        if (this.state.selectedLaps.length === 0) {
            document.getElementById('launch-btn').disabled = true;
            return;
        }

        this.state.selectedLaps.forEach(item => {
            const chip = document.createElement('div');
            chip.className = 'chip';
            chip.innerHTML = `
                <span class="chip-dot" style="background:${item.color}"></span>
                <span>${item.name}</span>
                <button>×</button>
            `;
            chip.querySelector('button').addEventListener('click', () => {
                this.state.selectedLaps = [];
                document.querySelectorAll('.lap-item').forEach(p => p.classList.remove('selected'));
                this.renderSelectedLaps();
            });
            container.appendChild(chip);
        });

        document.getElementById('launch-btn').disabled = false;
    }

    async launchReplay() {
        const btn = document.getElementById('launch-btn');
        btn.disabled = true;
        btn.innerHTML = '<i data-lucide="loader-2" class="spin"></i> Loading...';
        lucide.createIcons();

        try {
            const laps = [
                {
                    chassis: this.state.goldenLap.chassis,
                    car_number: this.state.goldenLap.car_number,
                    lap: this.state.goldenLap.lap,
                    name: 'Golden Lap',
                    color: GOLDEN_COLOR,
                    isGolden: true
                },
                ...this.state.selectedLaps
            ];

            const payload = await api.prepareReplay(this.state.selectedCircuit, laps);

            // Fetch rich analysis if we have a user lap selected
            if (this.state.selectedLaps.length > 0) {
                const userLap = this.state.selectedLaps[0];
                try {
                    console.log('Fetching analysis...');
                    const analysis = await api.compareLap(
                        this.state.selectedCircuit,
                        userLap.chassis,
                        userLap.car_number,
                        userLap.lap
                    );
                    this.state.analysisData = analysis;
                    console.log('Analysis loaded:', analysis);
                } catch (e) {
                    console.warn("Could not load analysis data:", e);
                }
            }

            this.startReplay(payload.timelines || []);
        } catch (err) {
            console.error('Failed to prepare replay', err);
            alert('Error launching replay.');
            btn.innerHTML = '<span>Launch Replay</span> <i data-lucide="play-circle"></i>';
            btn.disabled = false;
            lucide.createIcons();
        }
    }

    startReplay(timelines) {
        if (!timelines.length) return;

        document.getElementById('setup-panel').classList.remove('active');
        document.getElementById('viewer-panel').classList.add('active');

        this.viewer = new RaceViewer('scene-container');
        this.viewer.configureTrack(timelines);

        // Inject analysis data
        if (this.state.analysisData) {
            this.viewer.setAnalysisData(this.state.analysisData);
        }

        this.state.totalTime = Math.max(...timelines.map(t => t.duration || t.timeline?.at(-1)?.time || 80));
        const targetLapTime = Math.max(18, Math.min(36, this.state.totalTime || 36));
        this.viewer.setVisualLapTime(targetLapTime);

        timelines.forEach(timeline => this.viewer.addCar(timeline));
        this.viewer.showAnalysis('lap');

        this.state.currentTime = 0;
        this.state.isPlaying = true;
        this.state.lastFrame = performance.now();

        const playBtn = document.getElementById('btn-play');
        playBtn.innerHTML = '<i data-lucide="pause"></i>';
        lucide.createIcons();

        requestAnimationFrame(ts => this.loop(ts));
    }

    loop(timestamp) {
        if (!this.viewer) return;

        const dt = (timestamp - this.state.lastFrame) / 1000;
        this.state.lastFrame = timestamp;

        if (this.state.isPlaying) {
            this.state.currentTime += dt * this.state.playbackSpeed;
            if (this.state.currentTime > this.state.totalTime) {
                this.state.currentTime = 0;
            }
        }

        this.viewer.update(this.state.currentTime);

        if (this.viewer.cars.length >= 1) {
            this.ui.updateTelemetry(this.viewer.cars[0], this.viewer.cars[1]);
        }

        this.ui.updateLeaderboard(this.viewer.cars);

        requestAnimationFrame(ts => this.loop(ts));
    }

    togglePlay() {
        this.state.isPlaying = !this.state.isPlaying;
        const playBtn = document.getElementById('btn-play');
        playBtn.innerHTML = this.state.isPlaying ? '<i data-lucide="pause"></i>' : '<i data-lucide="play"></i>';
        lucide.createIcons();
        this.state.lastFrame = performance.now();
    }

    restart() {
        this.state.currentTime = 0;
        this.state.lastFrame = performance.now();
    }
}

new App();