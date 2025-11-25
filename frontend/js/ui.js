export class UI {
    constructor() {
        this.leaderboard = document.getElementById('leaderboard');

        // Golden Elements
        this.goldenName = document.getElementById('golden-telemetry-name');
        this.goldenSpeed = document.getElementById('golden-metric-speed');
        this.goldenThrottle = document.getElementById('golden-metric-throttle');
        this.goldenBrake = document.getElementById('golden-metric-brake');

        // User Elements
        this.userName = document.getElementById('user-telemetry-name');
        this.userSpeed = document.getElementById('user-metric-speed');
        this.userThrottle = document.getElementById('user-metric-throttle');
        this.userBrake = document.getElementById('user-metric-brake');
        this.userDistance = document.getElementById('metric-distance');
        this.gapMetric = document.getElementById('metric-gap');
    }

    updateLeaderboard(cars) {
        if (!cars.length) return;

        const sorted = [...cars].sort((a, b) => (b.currentState?.distance || 0) - (a.currentState?.distance || 0));

        const html = sorted.map((car, index) => {
            const isGolden = car.data.name === 'Golden Lap';
            const color = car.data.color;

            return `
            <div class="entry">
                <span style="display:flex; align-items:center; gap:6px;">
                    <span class="color-dot" style="background:${color};"></span>
                    <span style="${isGolden ? 'color:var(--golden); font-weight:bold' : ''}">
                        ${index + 1}. ${isGolden ? 'Golden' : 'Ghost'}
                    </span>
                </span>
                <span>${(car.currentState?.speed || 0).toFixed(0)}</span>
            </div>
        `}).join('');

        this.leaderboard.innerHTML = html;
    }

    updateTelemetry(goldenCar, userCar) {
        // Update Golden Block
        if (goldenCar && goldenCar.currentState) {
            this.goldenSpeed.innerHTML = `${goldenCar.currentState.speed.toFixed(0)} <small>km/h</small>`;
            this.goldenThrottle.style.width = `${Math.min(100, Math.max(0, goldenCar.currentState.throttle))}%`;
            this.goldenBrake.style.width = `${Math.min(100, Math.max(0, goldenCar.currentState.brake * 1.5))}%`;
        }

        // Update User Block
        if (userCar && userCar.currentState) {
            this.userName.textContent = userCar.data.name;
            this.userSpeed.innerHTML = `${userCar.currentState.speed.toFixed(0)} <small>km/h</small>`;
            this.userThrottle.style.width = `${Math.min(100, Math.max(0, userCar.currentState.throttle))}%`;
            this.userBrake.style.width = `${Math.min(100, Math.max(0, userCar.currentState.brake * 1.5))}%`;
            this.userDistance.textContent = `${userCar.currentState.distance.toFixed(0)} m`;

            if (goldenCar && goldenCar.currentState) {
                const distDiff = goldenCar.currentState.distance - userCar.currentState.distance;
                const currentSpeedMs = Math.max(10, userCar.currentState.speed / 3.6);
                const timeGap = distDiff / currentSpeedMs;

                let gapStr = "+0.00";
                let gapClass = "neutral";

                if (Math.abs(timeGap) < 0.01) {
                    gapStr = "0.00";
                } else if (timeGap > 0) {
                    gapStr = `+${Math.abs(timeGap).toFixed(2)}`;
                    gapClass = "pos"; // Red
                } else {
                    gapStr = `-${Math.abs(timeGap).toFixed(2)}`;
                    gapClass = "neg"; // Green
                }

                this.gapMetric.textContent = `${gapStr}s`;
                this.gapMetric.className = `value ${gapClass}`;
            }
        }
    }
}