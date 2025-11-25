// State Management
const state = {
    circuits: [],
    selectedCircuit: null,
    selectedRace: 'R1',
    selectedVehicle: null,
    selectedLap: null,
    goldenLap: null,
    analysisResult: null,
    vehicles: [],
    laps: [],
    vehiclePage: 0,
    lapPage: 0
};

const VEHICLES_PER_PAGE = 6;
const LAPS_PER_PAGE = 6;
let currentCoachTab = 'classic';

let currentTrackTab = 'comparison';
let currentChartTab = 'speed';

// Initialize App
async function init() {
    console.log('🚀 Initializing Apex Replay...');

    await loadCircuits();

    document.getElementById('circuit-select').addEventListener('change', onCircuitChange);
    setupTrackTabs();
    setupCoachTabs();
    setupChartTabs();
}

// Load Circuits
async function loadCircuits() {
    try {
        const circuits = await api.getCircuits();
        const select = document.getElementById('circuit-select');
        state.circuits = circuits || [];

        select.innerHTML = '<option value="">Select a circuit...</option>';
        circuits.forEach(circuit => {
            const option = document.createElement('option');
            option.value = circuit.id;
            option.textContent = circuit.length_miles
                ? `${circuit.name} (${circuit.length_miles} mi)`
                : circuit.name;
            select.appendChild(option);
        });

        console.log('✅ Circuits loaded');
    } catch (error) {
        console.error('❌ Failed to load circuits:', error);
        alert('Failed to load circuits. Make sure the backend is running on http://localhost:8000');
    }
}

// Circuit Change Handler
async function onCircuitChange(event) {
    const circuit = event.target.value;

    if (!circuit) {
        resetVehicleSelection();
        return;
    }

    state.selectedCircuit = circuit;
    state.selectedRace = resolvePreferredRaceForCircuit(circuit);
    console.log(`📍 Circuit selected: ${circuit} (${state.selectedRace})`);

    // Show loading for vehicles
    document.getElementById('vehicle-list').innerHTML = '<p class="text-gray-400">Loading vehicles...</p>';

    try {
        // Load golden lap info
        await loadGoldenLap(circuit, state.selectedRace);

        // Load vehicles
        await loadVehicles(circuit, state.selectedRace);
    } catch (error) {
        console.error('Error loading circuit data:', error);
        document.getElementById('vehicle-list').innerHTML = `<p class="text-red-400">Error: ${error.message}</p>`;
    }
}

function resolvePreferredRaceForCircuit(circuitId) {
    const meta = Array.isArray(state.circuits)
        ? state.circuits.find(c => c.id === circuitId)
        : null;
    const races = Array.isArray(meta?.races) ? meta.races.map(r => String(r || '').toUpperCase()) : [];
    if (!races.length) {
        return 'R1';
    }
    if (races.includes('R1')) {
        return 'R1';
    }
    return races[0];
}

// Load Golden Lap
async function loadGoldenLap(circuit, race = state.selectedRace) {
    try {
        const golden = await api.getGoldenLap(circuit, race);
        state.goldenLap = golden;

        // Display golden lap card
        const card = document.getElementById('golden-lap-card');
        const info = document.getElementById('golden-lap-info');

        info.innerHTML = `
            <p class="text-sm">Chassis <strong>${golden.chassis}</strong> • Car #<strong>${golden.car_number}</strong></p>
            <p class="text-2xl font-bold mt-2">${golden.formatted_time}</p>
            <p class="text-sm opacity-75">Lap ${golden.lap}</p>
        `;

        card.classList.remove('hidden');

        console.log('🏆 Golden lap loaded:', golden.formatted_time);
    } catch (error) {
        console.error('❌ Failed to load golden lap:', error);
    }
}

// Load Vehicles
async function loadVehicles(circuit, race = state.selectedRace) {
    try {
        console.log('Loading vehicles for', circuit);
        const vehicles = await api.getVehicles(circuit, race);
        state.vehicles = vehicles || [];
        state.vehiclePage = 0;
        state.selectedVehicle = null;
        state.selectedLap = null;
        state.laps = [];
        renderVehicleList();
        renderLapList();

        console.log(`✅ ${state.vehicles.length} vehicles loaded`);
    } catch (error) {
        console.error('❌ Failed to load vehicles:', error);
        document.getElementById('vehicle-list').innerHTML =
            `<p class="text-red-400">Error loading vehicles: ${error.message}</p>`;
    }
}

function renderVehicleList() {
    const container = document.getElementById('vehicle-list');
    const vehicles = state.vehicles || [];

    if (!vehicles.length) {
        container.innerHTML = '<p class="text-gray-400">No vehicles found</p>';
        return;
    }

    const totalPages = Math.max(1, Math.ceil(vehicles.length / VEHICLES_PER_PAGE));
    state.vehiclePage = Math.min(state.vehiclePage, totalPages - 1);

    const startIndex = state.vehiclePage * VEHICLES_PER_PAGE;
    const pageVehicles = vehicles.slice(startIndex, startIndex + VEHICLES_PER_PAGE);

    const grid = document.createElement('div');
    grid.className = 'grid grid-cols-1 sm:grid-cols-2 gap-3';

    pageVehicles.forEach(vehicle => {
        const isSelected = state.selectedVehicle &&
            state.selectedVehicle.chassis === vehicle.chassis &&
            state.selectedVehicle.car_number === vehicle.car_number;

        const button = document.createElement('button');
        button.className = `rounded px-4 py-4 text-left transition bg-gray-700 hover:bg-blue-600 ${isSelected ? 'ring-2 ring-blue-500' : ''
            }`;
        button.innerHTML = `
            <div class="flex items-center justify-between">
                <div class="text-2xl">🏎️</div>
                <div class="text-xs uppercase tracking-wide text-gray-400">Laps: ${vehicle.total_laps}</div>
            </div>
            <div class="mt-2">
                <div class="font-semibold text-lg">Car #${vehicle.car_number}</div>
                <div class="text-sm text-gray-300">Chassis ${vehicle.chassis}</div>
            </div>
        `;
        button.onclick = () => onVehicleSelect(vehicle);
        grid.appendChild(button);
    });

    container.innerHTML = '';
    container.appendChild(grid);

    if (totalPages > 1) {
        const nav = document.createElement('div');
        nav.className = 'flex items-center justify-between mt-4 text-sm';
        nav.innerHTML = `
            <button class="px-3 py-1 rounded bg-gray-800 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
                ${state.vehiclePage === 0 ? 'disabled' : ''}>
                ◀ Prev
            </button>
            <span class="text-gray-400">Page ${state.vehiclePage + 1} / ${totalPages}</span>
            <button class="px-3 py-1 rounded bg-gray-800 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
                ${state.vehiclePage >= totalPages - 1 ? 'disabled' : ''}>
                Next ▶
            </button>
        `;
        const navButtons = nav.querySelectorAll('button');
        const prevBtn = navButtons[0];
        const nextBtn = navButtons[1];
        prevBtn.onclick = () => {
            if (state.vehiclePage > 0) {
                state.vehiclePage--;
                renderVehicleList();
            }
        };
        nextBtn.onclick = () => {
            if (state.vehiclePage < totalPages - 1) {
                state.vehiclePage++;
                renderVehicleList();
            }
        };
        container.appendChild(nav);
    }
}

// Vehicle Selection Handler
async function onVehicleSelect(vehicle) {
    state.selectedVehicle = vehicle;
    state.selectedLap = null;
    state.analysisResult = null;
    renderVehicleList();

    console.log(`🏎️ Vehicle selected: Chassis ${vehicle.chassis}, Car #${vehicle.car_number}`);

    document.getElementById('lap-list').innerHTML = '<p class="text-gray-400">Loading laps...</p>';

    await loadLaps(state.selectedCircuit, vehicle.chassis, vehicle.car_number, state.selectedRace);
}

// Load Laps
async function loadLaps(circuit, chassis, carNumber, race = state.selectedRace) {
    try {
        console.log(`Loading laps for ${circuit}, chassis ${chassis}, car ${carNumber}`);
        const laps = await api.getLaps(circuit, chassis, carNumber, race);
        state.laps = laps || [];
        state.lapPage = 0;
        renderLapList();

        console.log(`✅ ${state.laps.length} laps loaded`);
    } catch (error) {
        console.error('❌ Failed to load laps:', error);
        document.getElementById('lap-list').innerHTML =
            `<p class="text-red-400">Error loading laps: ${error.message}</p>`;
    }
}

function renderLapList() {
    const container = document.getElementById('lap-list');
    const laps = state.laps || [];

    if (!laps.length) {
        container.innerHTML = state.selectedVehicle
            ? '<p class="text-gray-400">No laps found</p>'
            : '<p class="text-gray-400">Select a vehicle first</p>';
        return;
    }

    const totalPages = Math.max(1, Math.ceil(laps.length / LAPS_PER_PAGE));
    state.lapPage = Math.min(state.lapPage, totalPages - 1);

    const startIndex = state.lapPage * LAPS_PER_PAGE;
    const pageLaps = laps.slice(startIndex, startIndex + LAPS_PER_PAGE);
    const goldenTime = state.goldenLap?.time;
    const isGoldenVehicle = state.goldenLap &&
        state.selectedVehicle &&
        state.selectedVehicle.chassis === state.goldenLap.chassis &&
        state.selectedVehicle.car_number === state.goldenLap.car_number;

    const list = document.createElement('div');
    list.className = 'space-y-3';

    pageLaps.forEach(lap => {
        const isActive = state.selectedLap && state.selectedLap.lap_number === lap.lap_number;
        const isGoldenLap = isGoldenVehicle && lap.lap_number === state.goldenLap.lap;
        const delta = goldenTime ? lap.lap_time - goldenTime : null;
        const deltaText = delta !== null ? `${delta > 0 ? '+' : ''}${delta.toFixed(3)}s vs golden` : '';

        const button = document.createElement('button');
        button.className = `w-full rounded px-4 py-4 text-left transition bg-gray-700 hover:bg-green-600 ${isActive ? 'ring-2 ring-green-500' : ''
            }`;
        button.innerHTML = `
            <div class="flex justify-between items-center">
                <div class="font-semibold">
                    Lap ${lap.lap_number}
                    ${isGoldenLap ? '<span class="ml-2 text-yellow-400">🏆</span>' : ''}
                </div>
                <div class="text-lg font-mono">${lap.formatted_time}</div>
            </div>
            <div class="text-xs text-gray-300 mt-2">${deltaText}</div>
        `;
        button.onclick = () => onLapSelect(lap);
        list.appendChild(button);
    });

    container.innerHTML = '';
    container.appendChild(list);

    if (totalPages > 1) {
        const nav = document.createElement('div');
        nav.className = 'flex items-center justify-between mt-4 text-sm';
        nav.innerHTML = `
            <button class="px-3 py-1 rounded bg-gray-800 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
                ${state.lapPage === 0 ? 'disabled' : ''}>
                ◀ Prev
            </button>
            <span class="text-gray-400">Page ${state.lapPage + 1} / ${totalPages}</span>
            <button class="px-3 py-1 rounded bg-gray-800 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
                ${state.lapPage >= totalPages - 1 ? 'disabled' : ''}>
                Next ▶
            </button>
        `;
        const navButtons = nav.querySelectorAll('button');
        const prevBtn = navButtons[0];
        const nextBtn = navButtons[1];
        prevBtn.onclick = () => {
            if (state.lapPage > 0) {
                state.lapPage--;
                renderLapList();
            }
        };
        nextBtn.onclick = () => {
            if (state.lapPage < totalPages - 1) {
                state.lapPage++;
                renderLapList();
            }
        };
        container.appendChild(nav);
    }
}

// Lap Selection Handler
async function onLapSelect(lap) {
    state.selectedLap = lap;
    console.log(`⏱️ Lap selected: ${lap.lap_number} (${lap.formatted_time})`);
    renderLapList();

    // Analyze lap
    await analyzeLap();
}

// Analyze Lap
async function analyzeLap() {
    if (!state.selectedCircuit || !state.selectedVehicle || !state.selectedLap) {
        console.warn('⚠️ Missing selection data');
        return;
    }

    // Show loading
    document.getElementById('initial-message').classList.add('hidden');
    document.getElementById('consistency-panel').classList.add('hidden');
    document.getElementById('track-visual-panel').classList.add('hidden');
    document.getElementById('coach-panel').classList.add('hidden');
    document.getElementById('hotzones-panel').classList.add('hidden');
    document.getElementById('chart-panel').classList.add('hidden');
    const resultsPanel = document.getElementById('results-panel');
    resultsPanel.innerHTML = `
        <div class="bg-gray-800 rounded-lg p-12 text-center">
            <div class="animate-spin text-6xl mb-4">⚙️</div>
            <p class="text-xl">Analyzing lap...</p>
            <p class="text-gray-400 text-sm mt-2">This may take a few moments</p>
        </div>
    `;
    resultsPanel.classList.remove('hidden');

    try {
        console.log('🔍 Starting analysis...');

        const result = await api.compareLap(
            state.selectedCircuit,
            state.selectedVehicle.chassis,
            state.selectedVehicle.car_number,
            state.selectedLap.lap_number,
            state.selectedRace
        );

        state.analysisResult = result;
        console.log('✅ Analysis complete:', result);

        // Display results
        displayResults(result);

    } catch (error) {
        console.error('❌ Analysis failed:', error);
        resultsPanel.innerHTML = `
            <div class="bg-red-900 rounded-lg p-12 text-center">
                <div class="text-6xl mb-4">❌</div>
                <p class="text-xl">Analysis failed</p>
                <p class="text-gray-300 mt-2">${error.message}</p>
            </div>
        `;
        document.getElementById('track-visual-panel').classList.add('hidden');
        document.getElementById('coach-panel').classList.add('hidden');
        document.getElementById('hotzones-panel').classList.add('hidden');
        document.getElementById('consistency-panel').classList.add('hidden');
        document.getElementById('chart-panel').classList.add('hidden');
    }
}

// Display Results
function displayResults(result) {
    console.log('Displaying results:', result);
    document.getElementById('initial-message').classList.add('hidden');

    // Summary HTML
    const summaryHtml = `
        <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div class="text-center p-4 bg-gray-700 rounded-lg">
                <p class="text-gray-400 text-sm mb-2">Your Time</p>
                <p class="text-3xl font-bold text-red-400">${result.user_lap_formatted}</p>
            </div>
            <div class="text-center p-4 bg-gray-700 rounded-lg">
                <p class="text-gray-400 text-sm mb-2">Golden Lap</p>
                <p class="text-3xl font-bold text-yellow-400">${result.golden_lap_formatted}</p>
            </div>
            <div class="text-center p-4 bg-gray-700 rounded-lg">
                <p class="text-gray-400 text-sm mb-2">Difference</p>
                <p class="text-3xl font-bold ${result.time_diff > 0 ? 'text-red-400' : 'text-green-400'}">
                    ${result.time_diff > 0 ? '+' : ''}${result.time_diff.toFixed(3)}s
                </p>
            </div>
        </div>
    `;

    // Recommendations HTML
    const recommendations = Array.isArray(result.recommendations) ? result.recommendations : [];
    const recommendationsHtml = recommendations.length > 0
        ? recommendations.map((rec, index) => `
            <div class="bg-gray-700 rounded-lg p-6 mb-4 hover:bg-gray-600 transition">
                <div class="flex items-start gap-4">
                    <div class="text-4xl font-bold text-blue-400">${index + 1}</div>
                    <div class="flex-1">
                        <p class="text-lg font-semibold mb-2">
                            Sector ${rec.sector} 
                            <span class="text-gray-400 text-sm font-normal">(${rec.distance}m)</span>
                        </p>
                        <div class="space-y-2">
                            <p class="text-red-300">⚠️ ${rec.issue}</p>
                            <p class="text-blue-300">💡 ${rec.suggestion}</p>
                            <div class="flex gap-4 text-sm text-gray-400 mt-3">
                                <span>📉 Loss: ${rec.speed_loss.toFixed(1)} km/h</span>
                                <span>⏱️ Potential gain: ${rec.estimated_gain.toFixed(3)}s</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `).join('')
        : '<p class="text-gray-400">Perfect lap! No significant improvements detected.</p>';

    const summaryPanel = document.getElementById('results-panel');
    summaryPanel.classList.remove('hidden');
    summaryPanel.innerHTML = `
        <h2 class="text-2xl font-semibold mb-4 flex items-center gap-2">
            <span>📊</span>
            <span>Analysis Results</span>
        </h2>
        ${summaryHtml}
    `;

    renderConsistencyPanel(result.consistency, result.progression);

    state.analysisResult = result;

    document.getElementById('track-visual-panel').classList.remove('hidden');
    switchTrackTab(currentTrackTab);

    renderCoachPanel(recommendationsHtml, result.ai_coach, result.session_context);
    renderHotZonesPanel(result.hot_zones);

    document.getElementById('chart-panel').classList.remove('hidden');
    switchChartTab(currentChartTab, result);
}

// Draw Speed Chart
function drawSpeedChart(result) {
    const canvas = document.getElementById('speed-chart');
    if (!canvas) {
        console.error('Canvas not found');
        return;
    }

    const ctx = canvas.getContext('2d');

    if (window.speedChart) {
        window.speedChart.destroy();
        window.speedChart = null;
    }

    const userTelemetry = prepareTelemetryDataset(result.telemetry.user);
    const goldenTelemetry = prepareTelemetryDataset(result.telemetry.golden);

    if (userTelemetry.length === 0 || goldenTelemetry.length === 0) {
        showChartMessage(canvas, 'Not enough telemetry to draw the speed trace.');
        return;
    }

    // Determine a shared distance range to avoid extrapolation artifacts
    const startDist = Math.max(userTelemetry[0].Laptrigger_lapdist_dls, goldenTelemetry[0].Laptrigger_lapdist_dls, 0);
    const endDist = Math.min(
        userTelemetry[userTelemetry.length - 1].Laptrigger_lapdist_dls,
        goldenTelemetry[goldenTelemetry.length - 1].Laptrigger_lapdist_dls
    );

    if (endDist <= startDist) {
        showChartMessage(canvas, 'Distance data overlap is too small to draw the speed trace.');
        return;
    }

    const step = 10; // meters
    const distances = generateDistanceGrid(startDist, endDist, step);

    const userSpeeds = smoothSeries(resampleSpeedsForGrid(userTelemetry, distances), 5);
    const goldenSpeeds = smoothSeries(resampleSpeedsForGrid(goldenTelemetry, distances), 5);

    canvas.classList.remove('hidden');
    hideChartMessage(canvas);

    window.speedChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: distances.map(d => Math.round(d)),
            datasets: [
                {
                    label: 'Your Lap',
                    data: userSpeeds,
                    borderColor: 'rgb(239, 68, 68)',
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    borderWidth: 3,
                    tension: 0.4,
                    pointRadius: 0,
                    fill: false
                },
                {
                    label: 'Golden Lap',
                    data: goldenSpeeds,
                    borderColor: 'rgb(251, 191, 36)',
                    backgroundColor: 'rgba(251, 191, 36, 0.1)',
                    borderWidth: 3,
                    tension: 0.4,
                    pointRadius: 0,
                    fill: false
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            interaction: {
                mode: 'index',
                intersect: false
            },
            spanGaps: false,
            plugins: {
                legend: {
                    labels: {
                        color: 'white',
                        font: { size: 14 }
                    }
                },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    backgroundColor: 'rgba(0, 0, 0, 0.8)',
                    callbacks: {
                        label: function (context) {
                            return context.dataset.label + ': ' + context.parsed.y.toFixed(1) + ' km/h';
                        }
                    }
                }
            },
            scales: {
                x: {
                    title: {
                        display: true,
                        text: 'Distance (m)',
                        color: 'white',
                        font: { size: 14 }
                    },
                    ticks: { color: 'rgb(156, 163, 175)' },
                    grid: { color: 'rgba(255, 255, 255, 0.05)' }
                },
                y: {
                    title: {
                        display: true,
                        text: 'Speed (km/h)',
                        color: 'white',
                        font: { size: 14 }
                    },
                    ticks: { color: 'rgb(156, 163, 175)' },
                    grid: { color: 'rgba(255, 255, 255, 0.05)' }
                }
            }
        }
    });

    console.log('✅ Speed chart drawn with interpolation');
}

function drawProgressionChart(progression) {
    const canvas = document.getElementById('progress-chart');
    if (!canvas) {
        console.error('Progress chart canvas missing');
        return;
    }
    if (!progression || !progression.laps || progression.laps.length === 0) {
        if (window.progressChart) {
            window.progressChart.destroy();
            window.progressChart = null;
        }
        showChartMessage(canvas, 'Not enough laps to chart progression yet.');
        return;
    }

    const ctx = canvas.getContext('2d');
    if (window.progressChart) {
        window.progressChart.destroy();
    }
    hideChartMessage(canvas);

    const labels = progression.laps.map(l => `Lap ${l.lap}`);
    const lapTimes = progression.laps.map(l => l.time);

    window.progressChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'Lap time (s)',
                    data: lapTimes,
                    borderColor: 'rgb(59, 130, 246)',
                    backgroundColor: 'rgba(59, 130, 246, 0.2)',
                    borderWidth: 3,
                    tension: 0.3,
                    pointRadius: 4,
                    fill: true
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            scales: {
                x: {
                    ticks: { color: 'rgb(148, 163, 184)' },
                    grid: { color: 'rgba(255, 255, 255, 0.05)' }
                },
                y: {
                    title: {
                        display: true,
                        text: 'Time (s)',
                        color: 'white'
                    },
                    ticks: { color: 'rgb(148, 163, 184)' },
                    grid: { color: 'rgba(255, 255, 255, 0.05)' }
                }
            },
            plugins: {
                legend: {
                    labels: { color: 'white' }
                },
                tooltip: {
                    callbacks: {
                        label: ctx => `Lap time: ${ctx.parsed.y.toFixed(3)} s`
                    }
                }
            }
        }
    });
}

function drawHotzoneChart(hotZones) {
    const canvas = document.getElementById('hotzone-chart');
    if (!canvas) return;

    if (!hotZones || !hotZones.sectors || hotZones.sectors.length === 0) {
        if (window.hotzoneChart) {
            window.hotzoneChart.destroy();
            window.hotzoneChart = null;
        }
        showChartMessage(canvas, 'No variance data for hot/weak zones yet.');
        return;
    }

    const sectors = hotZones.sectors.slice(0, 12);
    const labels = sectors.map(s => `S${s.sector}`);
    const variances = sectors.map(s => s.variance);
    const colors = sectors.map(s => s.rating === 'weak'
        ? '#ef4444'
        : s.rating === 'excellent'
            ? '#10b981'
            : '#facc15'
    );

    const ctx = canvas.getContext('2d');
    if (window.hotzoneChart) {
        window.hotzoneChart.destroy();
    }
    hideChartMessage(canvas);

    window.hotzoneChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Speed variance (km/h²)',
                data: variances,
                backgroundColor: colors
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    labels: { color: 'white' }
                },
                tooltip: {
                    callbacks: {
                        label: ctx => `Variance: ${ctx.parsed.y.toFixed(2)} km/h²`
                    }
                }
            },
            scales: {
                x: {
                    ticks: { color: 'rgb(148, 163, 184)' },
                    grid: { color: 'rgba(255,255,255,0.05)' }
                },
                y: {
                    title: { display: true, text: 'Variance', color: 'white' },
                    ticks: { color: 'rgb(148, 163, 184)' },
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    beginAtZero: true
                }
            }
        }
    });
}

function drawTimelineChart(timeline) {
    const canvas = document.getElementById('timeline-chart');
    if (!canvas) return;

    if (!timeline || !timeline.length) {
        if (window.timelineChart) {
            window.timelineChart.destroy();
            window.timelineChart = null;
        }
        showChartMessage(canvas, 'No race timeline data yet.');
        return;
    }

    const labels = timeline.map(entry => `Lap ${entry.lap}`);
    const lapTimes = timeline.map(entry => entry.lap_time);
    const gaps = timeline.map(entry => entry.gap_to_golden);

    const ctx = canvas.getContext('2d');
    if (window.timelineChart) {
        window.timelineChart.destroy();
    }
    hideChartMessage(canvas);

    window.timelineChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'Lap time (s)',
                    data: lapTimes,
                    borderColor: '#60a5fa',
                    backgroundColor: 'rgba(96,165,250,0.2)',
                    borderWidth: 3,
                    tension: 0.3,
                    pointRadius: 3,
                    yAxisID: 'y'
                },
                {
                    label: 'Cumulative gap vs golden (s)',
                    data: gaps,
                    borderColor: '#f97316',
                    backgroundColor: 'rgba(249,115,22,0.2)',
                    borderWidth: 2,
                    tension: 0.2,
                    pointRadius: 2,
                    yAxisID: 'y1'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            interaction: {
                mode: 'index',
                intersect: false
            },
            scales: {
                y: {
                    position: 'left',
                    title: { display: true, text: 'Lap time (s)', color: 'white' },
                    ticks: { color: 'rgb(148, 163, 184)' },
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    beginAtZero: false
                },
                y1: {
                    position: 'right',
                    title: { display: true, text: 'Gap (s)', color: 'white' },
                    ticks: { color: 'rgb(248, 113, 113)' },
                    grid: { drawOnChartArea: false }
                },
                x: {
                    ticks: { color: 'rgb(148, 163, 184)' },
                    grid: { color: 'rgba(255,255,255,0.05)' }
                }
            },
            plugins: {
                legend: { labels: { color: 'white' } },
                tooltip: {
                    callbacks: {
                        label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y?.toFixed(3) ?? '–'} s`
                    }
                }
            }
        }
    });
}

function showChartMessage(canvas, message) {
    if (!canvas) return;
    const wrapper = canvas.parentElement;
    if (!wrapper) return;
    let banner = wrapper.querySelector('.chart-empty');
    if (!banner) {
        banner = document.createElement('div');
        banner.className = 'chart-empty text-center text-sm text-gray-400 py-6';
        wrapper.appendChild(banner);
    }
    banner.textContent = message;
    banner.classList.remove('hidden');
    canvas.classList.add('hidden');
}

function hideChartMessage(canvas) {
    if (!canvas) return;
    const wrapper = canvas.parentElement;
    if (!wrapper) return;
    const banner = wrapper.querySelector('.chart-empty');
    if (banner) {
        banner.classList.add('hidden');
    }
    canvas.classList.remove('hidden');
}

// Helpers for chart preparation
function prepareTelemetryDataset(telemetry) {
    if (!Array.isArray(telemetry)) return [];

    const sanitized = telemetry
        .filter(point =>
            typeof point?.Laptrigger_lapdist_dls === 'number' &&
            typeof point?.Speed === 'number'
        )
        .map(point => ({
            Laptrigger_lapdist_dls: Number(point.Laptrigger_lapdist_dls),
            Speed: Number(point.Speed)
        }))
        .sort((a, b) => a.Laptrigger_lapdist_dls - b.Laptrigger_lapdist_dls);

    const deduped = [];
    sanitized.forEach(point => {
        const last = deduped[deduped.length - 1];
        if (last && Math.abs(last.Laptrigger_lapdist_dls - point.Laptrigger_lapdist_dls) < 0.001) {
            deduped[deduped.length - 1] = point;
        } else {
            deduped.push(point);
        }
    });

    return deduped;
}

function generateDistanceGrid(start, end, step) {
    const grid = [];
    for (let d = start; d <= end; d += step) {
        grid.push(Number(d.toFixed(2)));
    }
    if (grid[grid.length - 1] !== end) {
        grid.push(Number(end.toFixed(2)));
    }
    return grid;
}

function resampleSpeedsForGrid(telemetry, grid) {
    if (telemetry.length === 0) return grid.map(() => null);

    const speeds = [];
    let idx = 0;

    grid.forEach(distance => {
        while (idx < telemetry.length && telemetry[idx].Laptrigger_lapdist_dls < distance) {
            idx++;
        }

        if (idx === 0) {
            speeds.push(telemetry[0].Speed);
        } else if (idx >= telemetry.length) {
            speeds.push(telemetry[telemetry.length - 1].Speed);
        } else {
            const before = telemetry[idx - 1];
            const after = telemetry[idx];
            const span = after.Laptrigger_lapdist_dls - before.Laptrigger_lapdist_dls;
            const t = span === 0 ? 0 : (distance - before.Laptrigger_lapdist_dls) / span;
            speeds.push(before.Speed + t * (after.Speed - before.Speed));
        }
    });

    return speeds;
}

function smoothSeries(values, windowSize = 3) {
    if (windowSize <= 1) return values;

    const half = Math.floor(windowSize / 2);
    return values.map((value, index) => {
        let sum = 0;
        let count = 0;

        for (let offset = -half; offset <= half; offset++) {
            const idx = index + offset;
            if (idx >= 0 && idx < values.length && typeof values[idx] === 'number') {
                sum += values[idx];
                count++;
            }
        }

        return count > 0 ? sum / count : value;
    });
}

function renderConsistencyPanel(consistency, progression) {
    const panel = document.getElementById('consistency-panel');
    if (!panel) return;
    if (!consistency) {
        panel.classList.add('hidden');
        panel.innerHTML = '';
        return;
    }

    const lapLayout = 'grid grid-cols-[90px,120px,120px,1fr] items-center gap-3 bg-gray-800/60 rounded px-3 py-2 text-sm';
    const lapHeader = `
        <div class="hidden md:grid grid-cols-[90px,120px,120px,1fr] gap-3 items-center text-xs text-gray-400 px-3 pb-2 uppercase tracking-wide">
            <div>Lap</div>
            <div>Time</div>
            <div>Δ vs avg</div>
            <div>Status</div>
        </div>
    `;
    const lapItems = (consistency.laps || []).map(lap => {
        const delta = typeof lap.delta_to_avg === 'number' ? lap.delta_to_avg : 0;
        return `
        <div class="${lapLayout}">
            <div class="font-semibold">${lap.icon} Lap ${lap.lap}</div>
            <div class="font-mono">${lap.formatted}</div>
            <div class="${delta >= 0 ? 'text-red-300' : 'text-emerald-300'}">
                ${delta >= 0 ? '+' : ''}${delta.toFixed(2)}s
            </div>
            <div class="text-gray-400">${lap.status}</div>
        </div>
    `;
    }).join('') || '<p class="text-sm text-gray-400">No lap history available.</p>';
    const lapBreakdown = lapHeader + lapItems;

    const progressionInsights = progression?.insights?.length
        ? `<div class="mt-4 text-sm text-gray-300">
                <strong>Progress insights:</strong>
                <ul class="mt-2 space-y-1 pl-4 text-gray-400">
                    ${progression.insights.map(item => `<li>• ${item}</li>`).join('')}
                </ul>
           </div>`
        : '';

    panel.classList.remove('hidden');
    panel.innerHTML = `
        <h3 class="text-xl font-semibold mb-4 flex items-center gap-2">
            <span>🎯</span>
            <span>Consistency Analyzer</span>
        </h3>
        <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div class="bg-gray-800/80 rounded p-4 text-center">
                <p class="text-gray-400 text-xs uppercase">Average lap</p>
                <p class="text-2xl font-bold">${consistency.average_formatted}</p>
            </div>
            <div class="bg-gray-800/80 rounded p-4 text-center">
                <p class="text-gray-400 text-xs uppercase">Best lap</p>
                <p class="text-2xl font-bold text-emerald-300">${consistency.best_formatted}</p>
            </div>
            <div class="bg-gray-800/80 rounded p-4 text-center">
                <p class="text-gray-400 text-xs uppercase">Worst lap</p>
                <p class="text-2xl font-bold text-red-300">${consistency.worst_formatted}</p>
            </div>
            <div class="bg-gray-800/80 rounded p-4 text-center">
                <p class="text-gray-400 text-xs uppercase">Consistency</p>
                <p class="text-2xl font-bold">${consistency.score}%</p>
                <p class="text-xs text-gray-400 mt-1">σ = ${consistency.std_dev.toFixed(2)}s</p>
            </div>
        </div>
        <div class="mt-6">
            <p class="text-sm text-blue-200 mb-2">Lap breakdown</p>
            <div class="space-y-2 max-h-60 overflow-y-auto pr-1">
                ${lapBreakdown}
            </div>
        </div>
        <div class="mt-4 text-sm text-gray-300">
            <strong>Recommendation:</strong> ${consistency.recommendation}
        </div>
        ${progressionInsights}
    `;
}

function renderHotZonesPanel(hotZones) {
    const panel = document.getElementById('hotzones-panel');
    if (!panel) return;
    if (!hotZones || !hotZones.sectors || hotZones.sectors.length === 0) {
        panel.classList.add('hidden');
        panel.innerHTML = '';
        return;
    }

    const renderList = (items, heading) => {
        if (!items || !items.length) {
            return `<p class="text-sm text-gray-500">${heading}: not enough laps to analyze.</p>`;
        }
        return `
            <p class="text-sm text-gray-400 mb-2">${heading}</p>
            <div class="space-y-2">
                ${items.map(item => `
                    <div class="flex justify-between bg-gray-800/70 rounded px-3 py-2 text-sm">
                        <div>Sector ${item.sector}</div>
                        <div class="text-gray-400 uppercase">${item.rating}</div>
                        <div>${item.variance.toFixed(2)} km/h^2</div>
                    </div>
                `).join('')}
            </div>
        `;
    };

    panel.classList.remove('hidden');
    panel.innerHTML = `
        <h3 class="text-xl font-semibold mb-4 flex items-center gap-2">
            <span>🔥</span>
            <span>Hot & Weak Zones</span>
        </h3>
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div class="bg-emerald-900/30 rounded-lg p-4 border border-emerald-500/30">
                ${renderList(hotZones.strong, 'Most stable sectors')}
            </div>
            <div class="bg-rose-900/30 rounded-lg p-4 border border-rose-500/30">
                ${renderList(hotZones.weak, 'Inconsistent sectors')}
            </div>
        </div>
        <p class="text-xs text-gray-500 mt-4">Variance is calculated from average sector speeds across the latest laps.</p>
    `;
}

function buildAIContent(aiData) {
    if (!aiData) {
        return '<p class="text-sm text-gray-400">AI Coach insights are not available.</p>';
    }
    const summary = aiData.summary || 'AI Coach insights are not available.';
    const raceBrief = aiData.race_brief;
    const recs = Array.isArray(aiData.recommendations) ? aiData.recommendations : [];
    const list = recs.length
        ? recs.map(rec => `
            <div class="bg-slate-800/70 rounded-lg p-4 border border-slate-700">
                <div class="flex items-center justify-between">
                    <p class="text-lg font-semibold text-blue-300">${rec.title || 'Suggestion'}</p>
                    <span class="text-xs uppercase text-gray-400">${rec.focus_area || 'Driving'}</span>
                </div>
                <p class="text-sm text-gray-200 mt-2">${rec.detail || ''}</p>
                <div class="text-xs text-gray-400 mt-3 flex justify-between">
                    <span>${rec.estimated_gain || ''}</span>
                    <span>Confidence: ${rec.confidence || 'medium'}</span>
                </div>
            </div>
        `).join('')
        : '<p class="text-sm text-gray-400">No AI-generated tips for this lap.</p>';

    return `
        ${raceBrief ? `<p class="text-xs text-amber-200 mb-2">${raceBrief}</p>` : ''}
        <p class="text-sm text-gray-300 mb-4">${summary}</p>
        <div class="space-y-3">
            ${list}
        </div>
    `;
}

function buildWeatherContent(weather) {
    if (!weather) {
        return '<p class="text-sm text-gray-400">Weather logs are not available for this session.</p>';
    }

    const statCard = (label, stat, unit = '') => {
        if (!stat) {
            return `
                <div class="bg-gray-800/80 rounded-lg p-4 border border-gray-700 text-sm text-gray-400">
                    <p class="uppercase tracking-wide text-xs">${label}</p>
                    <p class="mt-2">No data</p>
                </div>
            `;
        }
        return `
            <div class="bg-gray-800/80 rounded-lg p-4 border border-gray-700">
                <p class="uppercase tracking-wide text-xs text-gray-400">${label}</p>
                <p class="text-2xl font-semibold mt-2">${stat.avg}${unit}</p>
                <p class="text-xs text-gray-400 mt-1">Min ${stat.min}${unit} • Max ${stat.max}${unit}</p>
            </div>
        `;
    };

    const rainText = weather.rain ? 'Rain detected during the session.' : 'No rain recorded.';
    const windDirection = weather.wind_direction != null ? `${weather.wind_direction}° median direction` : 'Direction data unavailable.';

    return `
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
            ${statCard('Air temp (°C)', weather.air_temp, '°C')}
            ${statCard('Track temp (°C)', weather.track_temp, '°C')}
            ${statCard('Humidity (%)', weather.humidity, '%')}
            ${statCard('Pressure (hPa)', weather.pressure, ' hPa')}
            ${statCard('Wind speed (m/s)', weather.wind_speed, ' m/s')}
            <div class="bg-gray-800/80 rounded-lg p-4 border border-gray-700">
                <p class="uppercase tracking-wide text-xs text-gray-400">Wind & Rain</p>
                <p class="text-sm text-gray-300 mt-2">${windDirection}</p>
                <p class="text-sm text-gray-300 mt-1">${rainText}</p>
                <p class="text-xs text-gray-400 mt-2">${weather.samples || 0} samples recorded</p>
            </div>
        </div>
    `;
}

function renderCoachPanel(recommendationsHtml, aiData, sessionContext) {
    const panel = document.getElementById('coach-panel');
    if (!panel) return;
    sessionContext = sessionContext || {};

    const classicContainer = panel.querySelector('[data-coach-content="classic"]');
    const aiContainer = panel.querySelector('[data-coach-content="ai"]');
    const weatherContainer = panel.querySelector('[data-coach-content="weather"]');

    if (classicContainer) {
        classicContainer.innerHTML = `
            <h3 class="text-xl font-semibold mb-4 flex items-center gap-2">
                <span>🎯</span>
                <span>Top 3 Areas to Improve</span>
            </h3>
            ${recommendationsHtml}
        `;
    }
    if (aiContainer) {
        aiContainer.innerHTML = `
            <h3 class="text-xl font-semibold mb-4 flex items-center gap-2">
                <span>🤖</span>
                <span>AI Coach Insights</span>
            </h3>
            ${buildAIContent(aiData)}
        `;
    }
    if (weatherContainer) {
        weatherContainer.innerHTML = `
            <h3 class="text-xl font-semibold mb-4 flex items-center gap-2">
                <span>🌤️</span>
                <span>Weather</span>
            </h3>
            ${buildWeatherContent(sessionContext?.weather)}
        `;
    }

    panel.classList.remove('hidden');

    const availableTabs = Array.from(panel.querySelectorAll('[data-coach-content]')).map(el => el.dataset.coachContent);
    if (!availableTabs.includes(currentCoachTab)) {
        currentCoachTab = availableTabs[0] || 'classic';
    }
    switchCoachTab(currentCoachTab);
}

function setupTrackTabs() {
    const buttons = document.querySelectorAll('.track-tab');
    buttons.forEach(btn => {
        btn.addEventListener('click', () => switchTrackTab(btn.dataset.trackTab));
    });
    updateTrackLegend(currentTrackTab);
    setTrackControlsState(currentTrackTab);
}

function switchTrackTab(tab) {
    currentTrackTab = tab;
    document.querySelectorAll('.track-tab').forEach(btn => {
        if (btn.dataset.trackTab === tab) {
            btn.classList.add('bg-blue-800/40', 'text-white');
            btn.classList.remove('text-gray-400');
        } else {
            btn.classList.remove('bg-blue-800/40', 'text-white');
            btn.classList.add('text-gray-400');
        }
    });

    updateTrackLegend(tab);
    setTrackControlsState(tab);

    if (!state.analysisResult) return;
    const viewer = ensureTrackViewer();
    const result = state.analysisResult;
    if (tab === 'heatmap') {
        viewer.renderHeatmap(result.telemetry.user, result.hot_zones);
    } else if (tab === 'flow') {
        viewer.renderFlowDynamics(result.telemetry.user);
    } else if (tab === 'ghosts') {
        viewer.renderGhosts(result.telemetry.user, result.ghost_laps || []);
    } else {
        viewer.renderComparison(result.telemetry.user, result.telemetry.golden, result.recommendations);
    }
}

function setupChartTabs() {
    const buttons = document.querySelectorAll('.chart-tab');
    buttons.forEach(btn => btn.addEventListener('click', () => switchChartTab(btn.dataset.chartTab)));
}

function switchChartTab(tab, result = state.analysisResult) {
    currentChartTab = tab;
    document.querySelectorAll('.chart-tab').forEach(btn => {
        if (btn.dataset.chartTab === tab) {
            btn.classList.add('bg-blue-800/40', 'text-white');
            btn.classList.remove('text-gray-400');
        } else {
            btn.classList.remove('bg-blue-800/40', 'text-white');
            btn.classList.add('text-gray-400');
        }
    });

    document.querySelectorAll('[data-chart-content]').forEach(section => {
        section.classList.toggle('hidden', section.dataset.chartContent !== tab);
    });

    if (!result) return;
    if (tab === 'progression') {
        drawProgressionChart(result.progression);
    } else if (tab === 'hotzones') {
        drawHotzoneChart(result.hot_zones);
    } else if (tab === 'timeline') {
        drawTimelineChart(result.race_timeline);
    } else {
        drawSpeedChart(result);
    }
}

function updateTrackLegend(tab) {
    const legend = document.getElementById('track-legend');
    if (!legend) return;

    if (tab === 'heatmap') {
        legend.innerHTML = `
            <div class="flex items-center gap-4">
                <div class="flex items-center gap-2">
                    <div class="w-4 h-4 rounded" style="background:#10b981"></div>
                    <span>Excellent</span>
                </div>
                <div class="flex items-center gap-2">
                    <div class="w-4 h-4 rounded" style="background:#facc15"></div>
                    <span>Good</span>
                </div>
                <div class="flex items-center gap-2">
                    <div class="w-4 h-4 rounded" style="background:#fb923c"></div>
                    <span>OK</span>
                </div>
                <div class="flex items-center gap-2">
                    <div class="w-4 h-4 rounded" style="background:#ef4444"></div>
                    <span>Weak</span>
                </div>
            </div>
            <p class="text-xs text-gray-400">Hover a segment to read the sector score.</p>
        `;
    } else if (tab === 'flow') {
        legend.innerHTML = `
            <div class="flex items-center gap-6">
                <div class="flex items-center gap-2">
                    <div class="w-4 h-4 rounded" style="background:#22d3ee"></div>
                    <span>Fast flow</span>
                </div>
                <div class="flex items-center gap-2">
                    <div class="w-4 h-4 rounded" style="background:#facc15"></div>
                    <span>Balanced</span>
                </div>
                <div class="flex items-center gap-2">
                    <div class="w-4 h-4 rounded" style="background:#f97316"></div>
                    <span>Slow zones</span>
                </div>
            </div>
            <p class="text-xs text-gray-400">Animated orbs highlight momentum along the lap.</p>
        `;
    } else if (tab === 'ghosts') {
        legend.innerHTML = `
            <div class="flex flex-wrap gap-4 text-sm">
                <div class="flex items-center gap-2">
                    <div class="w-4 h-4 rounded bg-red-500"></div>
                    <span>Selected lap</span>
                </div>
                <div class="flex items-center gap-2">
                    <div class="w-4 h-4 rounded border border-white" style="background:#38bdf8"></div>
                    <span>Best/ghost laps</span>
                </div>
            </div>
            <p class="text-xs text-gray-400">Dash lines show alternate laps to compare against.</p>
        `;
    } else {
        legend.innerHTML = `
            <div class="flex items-center gap-3">
                <div class="w-4 h-4 rounded bg-red-500"></div>
                <span>Your Lap</span>
                <div class="w-4 h-4 rounded bg-yellow-400 ml-4"></div>
                <span>Golden Lap</span>
            </div>
            <p class="text-xs text-gray-400">Hover highlighted improvements to see tips.</p>
        `;
    }
}

function setTrackControlsState(tab) {
    const playBtn = document.getElementById('track-play-btn');
    if (!playBtn) return;
    const disabled = tab !== 'comparison';
    playBtn.disabled = disabled;
    playBtn.classList.toggle('opacity-40', disabled);
    playBtn.classList.toggle('cursor-not-allowed', disabled);
}

function setupCoachTabs() {
    const buttons = document.querySelectorAll('.coach-tab');
    buttons.forEach(btn => {
        btn.addEventListener('click', () => switchCoachTab(btn.dataset.coachTab));
    });
}

function switchCoachTab(tab) {
    let target = document.querySelector(`[data-coach-content="${tab}"]`);
    if (!target) {
        const fallback = document.querySelector('[data-coach-content]');
        if (!fallback) return;
        tab = fallback.dataset.coachContent;
        target = fallback;
    }
    currentCoachTab = tab;
    document.querySelectorAll('.coach-tab').forEach(btn => {
        if (btn.dataset.coachTab === tab) {
            btn.classList.add('bg-blue-800/40', 'text-white');
            btn.classList.remove('text-gray-400');
        } else {
            btn.classList.remove('bg-blue-800/40', 'text-white');
            btn.classList.add('text-gray-400');
        }
    });

    document.querySelectorAll('[data-coach-content]').forEach(section => {
        section.classList.toggle('hidden', section.dataset.coachContent !== tab);
    });
}

// Reset Functions
function resetVehicleSelection() {
    state.selectedCircuit = null;
    state.selectedRace = 'R1';
    state.selectedVehicle = null;
    state.selectedLap = null;
    state.goldenLap = null;
    state.analysisResult = null;
    state.vehicles = [];
    state.laps = [];
    state.vehiclePage = 0;
    state.lapPage = 0;

    document.getElementById('vehicle-list').innerHTML = '<p class="text-gray-400">Select a circuit first</p>';
    document.getElementById('lap-list').innerHTML = '<p class="text-gray-400">Select a vehicle first</p>';
    document.getElementById('golden-lap-card').classList.add('hidden');
    document.getElementById('results-panel').classList.add('hidden');
    document.getElementById('consistency-panel').classList.add('hidden');
    document.getElementById('coach-panel').classList.add('hidden');
    document.getElementById('hotzones-panel').classList.add('hidden');
    document.getElementById('chart-panel').classList.add('hidden');
    document.getElementById('track-visual-panel').classList.add('hidden');
    document.getElementById('initial-message').classList.remove('hidden');
}

// Track viewer singleton
let trackViewerInstance = null;
function ensureTrackViewer() {
    if (!trackViewerInstance) {
        trackViewerInstance = new Track2DViewer({
            containerId: 'track-visual-container',
            playButtonId: 'track-play-btn',
            resetButtonId: 'track-reset-btn'
        });
    }
    return trackViewerInstance;
}

// Start App
document.addEventListener('DOMContentLoaded', init);
