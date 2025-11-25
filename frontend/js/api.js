const API_BASE = 'http://localhost:8000/api';

async function httpGet(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
}

async function httpPost(url, payload) {
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
}

export const api = {
    async getCircuits() {
        const circuits = await httpGet(`${API_BASE}/circuits`);
        if (Array.isArray(circuits)) return circuits;
        return circuits?.circuits || [];
    },
    async getReplaySetup(circuit) {
        return httpGet(`${API_BASE}/replay/setup/${circuit}`);
    },
    async getVehicleLaps(circuit, chassis, car) {
        return httpGet(`${API_BASE}/replay/vehicle/${circuit}/${chassis}/${car}`);
    },
    async prepareReplay(circuit, laps) {
        return httpPost(`${API_BASE}/replay/prepare`, { circuit, laps });
    },
    async fetchCommentary(cars, currentTime) {
        return httpPost(`${API_BASE}/replay/commentary`, { cars, current_time: currentTime });
    },
    async compareLap(circuit, chassis, car, lap, race = 'R1') {
        return httpPost(`${API_BASE}/analysis/compare`, {
            circuit,
            chassis,
            car_number: car,
            lap,
            race
        });
    }
};