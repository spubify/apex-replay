const TWO_PI = Math.PI * 2;

export class RaceViewer {
    constructor(containerId) {
        if (!window.d3) throw new Error('D3.js must be loaded globally');
        this.d3 = window.d3;
        this.container = document.getElementById(containerId);
        this.width = this.container.clientWidth || window.innerWidth;
        this.height = this.container.clientHeight || window.innerHeight;
        this.visualLapTime = 30;
        this.analysisData = null; // Store external rich analysis

        this.svg = this.d3.select(this.container)
            .append('svg')
            .attr('class', 'track-map')
            .attr('width', '100%')
            .attr('height', '100%')
            .attr('viewBox', `0 0 ${this.width} ${this.height}`)
            .style('background', '#000');

        this._injectDefs();

        this.mainGroup = this.svg.append('g').attr('class', 'track-layer');
        this.trackLayer = this.mainGroup.append('g').attr('class', 'map-track');
        this.analysisLayer = this.mainGroup.append('g').attr('class', 'analysis-layer');
        this.carLayer = this.mainGroup.append('g').attr('class', 'map-cars');

        // Use body append for tooltip to avoid SVG stacking contexts clipping it
        this.tooltip = this._createTooltip();

        this.zoom = this.d3.zoom()
            .scaleExtent([0.5, 10])
            .on('zoom', (event) => {
                this.mainGroup.attr('transform', event.transform);
            });
        this.svg.call(this.zoom);

        this.cars = [];
        this.trackPaths = [];

        window.addEventListener('resize', () => this._onResize());
    }

    setAnalysisData(data) {
        console.log('📊 Viewer received Analysis Data:', data);
        this.analysisData = data;
    }

    configureTrack(timelines = []) {
        this.trackLayer.selectAll('*').remove();
        this.carLayer.selectAll('*').remove();
        this.analysisLayer.selectAll('*').remove();
        this.cars = [];
        this.trackPaths = [];

        if (!timelines.length) return;

        const allPoints = timelines.flatMap(t => t.timeline || []).map(p => ({
            x: p.position.x,
            y: p.position.z
        }));

        if (!allPoints.length) return;

        this._computeScales(allPoints);

        const line = this._lineGenerator();

        // Base Track (The "road" underneath)
        const primaryPoints = timelines[0].timeline.map(p => ({ x: p.position.x, y: p.position.z }));
        this.trackLayer.append('path')
            .datum(primaryPoints)
            .attr('d', line)
            .attr('stroke', '#1f1f25')
            .attr('stroke-width', 16)
            .attr('stroke-linejoin', 'round')
            .attr('stroke-linecap', 'round')
            .attr('fill', 'none');

        // Individual Lap Lines
        timelines.forEach((entry, idx) => {
            const points = (entry.timeline || []).map(p => ({
                x: p.position.x,
                y: p.position.z
            }));

            if (!points.length) return;

            // Assume index 0 is Golden (Golden color), index 1 is user (Blue)
            const isGolden = idx === 0;
            const color = isGolden ? '#eab308' : '#3b82f6';
            const width = isGolden ? 3 : 2;
            const opacity = isGolden ? 0.8 : 0.9;

            const path = this.trackLayer.append('path')
                .datum(points)
                .attr('class', isGolden ? 'track-golden' : 'track-user')
                .attr('d', line)
                .attr('stroke', color)
                .attr('stroke-width', width)
                .attr('fill', 'none')
                .attr('opacity', opacity);

            this.trackPaths.push({
                pathNode: path.node(),
                points: points,
                color,
                timeline: entry.timeline // Contains full telemetry including distance
            });
        });
    }

    addCar(data) {
        // ... (Car adding logic remains same, omitted for brevity if not changing) ...
        // Reuse previous logic
        const timeline = this._normalizeTimeline(data.timeline, data.duration, data.max_distance);
        const duration = timeline.at(-1)?.time || data.duration || 80;
        const maxDistance = timeline.at(-1)?.distance || data.max_distance || 1000;
        const trackData = this.trackPaths[0];
        const pathNode = trackData?.pathNode;
        const trackLength = pathNode?.getTotalLength() || 1;
        const carColor = data.color || '#ffffff';

        const group = this.carLayer.append('g')
            .attr('class', 'race-car')
            .attr('data-name', data.name)
            .style('cursor', 'pointer');

        const carPath = `M -10 6 L -10 -6 L -4 -7 L 2 -7 L 6 -5 L 10 -4 L 10 4 L 6 5 L 2 7 L -4 7 Z`;

        group.append('path')
            .attr('d', carPath)
            .attr('fill', carColor)
            .attr('stroke', 'rgba(0,0,0,0.5)')
            .attr('stroke-width', 1)
            .attr('transform', 'scale(1.2)');

        const labelGroup = group.append('g')
            .attr('class', 'car-label')
            .attr('transform', 'translate(0, -20)');

        labelGroup.append('rect')
            .attr('x', -30)
            .attr('y', -10)
            .attr('width', 60)
            .attr('height', 16)
            .attr('rx', 4)
            .attr('fill', 'rgba(0,0,0,0.7)')
            .attr('stroke', carColor)
            .attr('stroke-width', 1);

        labelGroup.append('text')
            .attr('y', 2)
            .attr('text-anchor', 'middle')
            .attr('fill', '#fff')
            .attr('font-size', '9px')
            .attr('font-weight', 'bold')
            .style('font-family', 'sans-serif')
            .text(data.name.replace('Lap', 'L').substring(0, 10));

        this.cars.push({
            group,
            timeline,
            duration,
            maxDistance,
            pathNode,
            trackLength,
            data: { ...data, color: carColor },
            currentState: { speed: 0, throttle: 0, brake: 0, distance: 0 }
        });
    }

    update(time) {
        if (!this.cars.length) return;
        const lapTime = this.visualLapTime || 30;

        this.cars.forEach(car => {
            if (!car.pathNode) return;

            const progress = lapTime > 0 ? (time % lapTime) / lapTime : 0;
            const timelineTime = progress * car.duration;
            const telemetry = this._sampleTelemetry(car.timeline, timelineTime);

            let x, y, angle = 0;

            // Logic to position car on track
            if (telemetry.position) {
                x = this.scaleX(telemetry.position.x);
                y = this.scaleY(telemetry.position.z);
                // Calculate angle
                const pathPoint = car.pathNode.getPointAtLength(progress * car.trackLength);
                const ahead = car.pathNode.getPointAtLength(((progress * car.trackLength) + 5) % car.trackLength);
                angle = Math.atan2(ahead.y - pathPoint.y, ahead.x - pathPoint.x) * 180 / Math.PI;
            } else {
                // Fallback
                const point = car.pathNode.getPointAtLength(progress * car.trackLength);
                const ahead = car.pathNode.getPointAtLength(((progress * car.trackLength) + 5) % car.trackLength);
                x = point.x;
                y = point.y;
                angle = Math.atan2(ahead.y - point.y, ahead.x - point.x) * 180 / Math.PI;
            }

            car.group.attr('transform', `translate(${x}, ${y}) rotate(${angle})`);

            car.currentState = {
                speed: telemetry.speed || 0,
                throttle: telemetry.throttle || 0,
                brake: telemetry.brake || 0,
                distance: telemetry.distance || 0
            };
        });
    }

    showAnalysis(mode = 'lap') {
        console.log(`🎨 showAnalysis called with mode: ${mode}`);
        this.analysisLayer.selectAll('*').remove();

        // We use the first timeline (usually Golden) as the base for drawing segments
        // because we want to highlight parts of the track geometry.
        const trackTimeline = this.trackPaths[0]?.timeline;

        if (!trackTimeline) {
            console.warn("No track timeline available for analysis.");
            return;
        }

        let segments = [];

        // Check if we have rich analysis data available for 'lap', 'consistency', or 'ai_insight' modes
        if (this.analysisData && (mode === 'lap' || mode === 'consistency' || mode === 'ai_insight')) {
            console.log("Using Rich Analysis Data");
            segments = this._segmentTrackFromAnalysis(trackTimeline, mode);
        } else {
            console.log("Using Local Flow Calculation");
            segments = this._segmentTrackLocal(trackTimeline, mode);
        }

        // Draw the segments
        const line = this.d3.line()
            .x(d => this.scaleX(d.x))
            .y(d => this.scaleY(d.z))
            .curve(this.d3.curveCatmullRom.alpha(0.5));

        const paths = this.analysisLayer.selectAll('path')
            .data(segments)
            .join('path')
            .attr('class', 'interactive')
            .attr('d', d => line(d.points))
            .attr('stroke', d => d.color)
            .attr('stroke-width', d => d.width)
            .attr('stroke-linecap', 'round')
            .attr('fill', 'none')
            .attr('opacity', 0.9)
            .style('cursor', 'pointer')
            .style('pointer-events', 'stroke'); // Critical for hovering lines

        // Attach events properly
        paths.on('mousemove', (event, d) => {
            this._showTooltip(event, d.tooltip);
        })
            .on('mouseout', () => {
                this._hideTooltip();
            });

        console.log(`drawn ${segments.length} segments`);
    }

    _segmentTrackFromAnalysis(fullTimeline, mode) {
        const segments = [];
        const sectorSize = 200; // Must match backend

        // Debug: Check if timeline has distance
        if (!fullTimeline || !fullTimeline.length) {
            console.warn("⚠️ Analysis: No timeline available for segmentation");
            return segments;
        }
        if (fullTimeline[0].distance === undefined) {
            console.warn("⚠️ Analysis: Timeline points missing 'distance' property", fullTimeline[0]);
            return segments;
        }

        if (mode === 'lap') {
            // recommendations: [{sector, distance, speed_loss, issue, suggestion...}]
            const recs = this.analysisData.recommendations || [];
            console.log(`📊 Analysis (Lap): Processing ${recs.length} recommendations`);

            // Get User Timeline for comparison (assuming index 1 is user, index 0 is golden)
            const userTimeline = this.trackPaths[1]?.timeline;

            recs.forEach((rec, index) => {
                // Use sector index for robust distance calculation, matching Consistency mode
                const startDist = rec.sector * sectorSize;
                const endDist = startDist + sectorSize;

                console.log(`   [Rec ${index}] Sector: ${rec.sector}, Dist: ${startDist}-${endDist}, Raw Dist: ${rec.distance}`);

                // Find timeline points that fall within this distance range
                const points = fullTimeline.filter(p => p.distance >= startDist && p.distance <= endDist);
                console.log(`   [Rec ${index}] Points found: ${points.length}`);

                if (points.length < 2) {
                    console.warn(`   ⚠️ [Rec ${index}] Not enough points found!`);
                    return;
                }

                // Calculate Golden Stats
                const gSpeeds = points.map(p => p.speed || 0);
                const gAvg = gSpeeds.reduce((a, b) => a + b, 0) / gSpeeds.length;
                const gMin = Math.min(...gSpeeds);
                const gMax = Math.max(...gSpeeds);

                // Calculate User Stats (if available)
                let uAvg = 0, uMin = 0, uMax = 0;
                let hasUser = false;
                if (userTimeline) {
                    const uPoints = userTimeline.filter(p => p.distance >= startDist && p.distance <= endDist);
                    if (uPoints.length > 0) {
                        const uSpeeds = uPoints.map(p => p.speed || 0);
                        uAvg = uSpeeds.reduce((a, b) => a + b, 0) / uSpeeds.length;
                        uMin = Math.min(...uSpeeds);
                        uMax = Math.max(...uSpeeds);
                        hasUser = true;
                    }
                }

                // Rich HTML Tooltip with Comparison
                const tooltipHtml = `
                    <div class="tooltip-header" style="color:#ef4444; border-color:#ef4444">Sector ${rec.sector} Comparison</div>
                    
                    <div style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap:8px; font-size:0.75rem; text-align:center; background:rgba(0,0,0,0.3); padding:8px; border-radius:4px; margin-bottom:8px">
                        <div style="text-align:left; color:#9ca3af">Metric</div>
                        <div style="color:#eab308; font-weight:600">Golden</div>
                        <div style="color:#3b82f6; font-weight:600">You</div>
                        
                        <div style="text-align:left; color:#d1d5db">Avg Speed</div>
                        <div>${gAvg.toFixed(0)}</div>
                        <div style="${hasUser && uAvg < gAvg ? 'color:#ef4444' : 'color:#4ade80'}">${hasUser ? uAvg.toFixed(0) : '-'}</div>

                        <div style="text-align:left; color:#d1d5db">Min Speed</div>
                        <div>${gMin.toFixed(0)}</div>
                        <div style="${hasUser && uMin < gMin ? 'color:#ef4444' : 'color:#4ade80'}">${hasUser ? uMin.toFixed(0) : '-'}</div>

                        <div style="text-align:left; color:#d1d5db">Max Speed</div>
                        <div>${gMax.toFixed(0)}</div>
                        <div style="${hasUser && uMax < gMax ? 'color:#ef4444' : 'color:#4ade80'}">${hasUser ? uMax.toFixed(0) : '-'}</div>
                    </div>

                    <div class="tooltip-data-grid">
                        <div class="tooltip-item">
                            <label>Speed Loss</label>
                            <span style="color:#ef4444">${rec.speed_loss.toFixed(1)} km/h</span>
                        </div>
                        <div class="tooltip-item">
                            <label>Est. Gain</label>
                            <span style="color:#4ade80">${rec.estimated_gain.toFixed(3)} s</span>
                        </div>
                    </div>
                `;

                segments.push({
                    points: points.map(p => p.position),
                    color: '#ef4444', // Red for issues
                    width: 8,
                    tooltip: tooltipHtml
                });
            });

        } else if (mode === 'consistency') {
            // hot_zones: { sectors: [{sector, rating, variance, avg_speed}] }
            const hotZones = this.analysisData.hot_zones || {};
            const sectorStats = hotZones.sectors || [];
            console.log(`📊 Analysis (Consistency): Processing ${sectorStats.length} sectors`);

            sectorStats.forEach(stat => {
                const startDist = stat.sector * sectorSize;
                const endDist = startDist + sectorSize;
                const points = fullTimeline.filter(p => p.distance >= startDist && p.distance <= endDist);

                if (points.length < 2) return;

                let color = '#3b82f6';
                if (stat.rating === 'excellent') color = '#10b981'; // Green
                else if (stat.rating === 'good') color = '#facc15'; // Yellow
                else if (stat.rating === 'weak') color = '#ef4444'; // Red

                // Calculate Golden Stats for comparison
                const gSpeeds = points.map(p => p.speed || 0);
                const gAvg = gSpeeds.reduce((a, b) => a + b, 0) / gSpeeds.length;
                // Golden variance is 0 (reference lap)

                const tooltipHtml = `
                    <div class="tooltip-header" style="color:${color}; border-color:${color}">Sector ${stat.sector} Consistency</div>
                    <div style="margin-bottom:8px">Rating: <strong style="text-transform:uppercase; color:${color}">${stat.rating}</strong></div>
                    
                    <div style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap:8px; font-size:0.75rem; text-align:center; background:rgba(0,0,0,0.3); padding:8px; border-radius:4px;">
                        <div style="text-align:left; color:#9ca3af">Metric</div>
                        <div style="color:#eab308; font-weight:600">Golden</div>
                        <div style="color:#3b82f6; font-weight:600">You</div>
                        
                        <div style="text-align:left; color:#d1d5db">Variance</div>
                        <div>0.0</div>
                        <div style="color:${stat.variance < 5 ? '#4ade80' : '#ef4444'}">${stat.variance.toFixed(1)}</div>

                        <div style="text-align:left; color:#d1d5db">Avg Speed</div>
                        <div>${gAvg.toFixed(0)}</div>
                        <div>${stat.avg_speed.toFixed(0)}</div>
                    </div>
                `;

                segments.push({
                    points: points.map(p => p.position),
                    color: color,
                    width: 6,
                    tooltip: tooltipHtml
                });
            });

        } else if (mode === 'ai_insight') {
            // track_insights: [{sector, type, color, message, detail}]
            const insights = this.analysisData.track_insights || [];
            console.log(`📊 Analysis (AI Insight): Processing ${insights.length} insights`);

            insights.forEach(insight => {
                const startDist = insight.sector * sectorSize;
                const endDist = startDist + sectorSize;
                const points = fullTimeline.filter(p => p.distance >= startDist && p.distance <= endDist);

                if (points.length < 2) return;

                // Calculate sector metrics
                const speeds = points.map(p => p.speed || 0);
                const avgSpeed = speeds.reduce((a, b) => a + b, 0) / speeds.length;
                const maxSpeed = Math.max(...speeds);
                const minSpeed = Math.min(...speeds);

                // Calculate momentum (simplified as exit speed vs entry speed)
                const entrySpeed = speeds[0];
                const exitSpeed = speeds[speeds.length - 1];
                const momentumDelta = exitSpeed - entrySpeed;
                const momentumColor = momentumDelta > 0 ? '#4ade80' : '#f87171';

                const tooltipHtml = `
                    <div class="tooltip-header" style="color:${insight.color}; border-color:${insight.color}">
                        AI Insight: Sector ${insight.sector}
                    </div>
                    <div class="tooltip-tag" style="background-color:${insight.color}">
                        ${insight.type}
                    </div>
                    <div style="font-weight:600; margin-bottom:8px">${insight.message}</div>
                    <div class="tooltip-detail" style="margin-bottom:12px">${insight.detail}</div>
                    
                    <div style="border-top:1px solid rgba(255,255,255,0.1); padding-top:8px; margin-top:8px">
                        <div style="font-size:0.75rem; color:#9ca3af; margin-bottom:4px; text-transform:uppercase">Sector Telemetry</div>
                        <div class="tooltip-data-grid">
                            <div class="tooltip-item">
                                <label>Avg Speed</label>
                                <span>${avgSpeed.toFixed(0)} <small>km/h</small></span>
                            </div>
                            <div class="tooltip-item">
                                <label>Max Speed</label>
                                <span>${maxSpeed.toFixed(0)} <small>km/h</small></span>
                            </div>
                            <div class="tooltip-item">
                                <label>Min Speed</label>
                                <span>${minSpeed.toFixed(0)} <small>km/h</small></span>
                            </div>
                            <div class="tooltip-item">
                                <label>Momentum</label>
                                <span style="color:${momentumColor}">${momentumDelta > 0 ? '+' : ''}${momentumDelta.toFixed(0)} <small>km/h</small></span>
                            </div>
                        </div>
                    </div>
                `;

                segments.push({
                    points: points.map(p => p.position),
                    color: insight.color,
                    width: 7,
                    tooltip: tooltipHtml
                });
            });
        }

        console.log(`✅ Analysis: Generated ${segments.length} segments for mode ${mode}`);
        return segments;
    }

    _segmentTrackLocal(timeline, mode) {
        const segments = [];
        const length = timeline.length;

        if (mode === 'flow') {
            // Just chop track into small chunks and color by speed
            const segmentSize = 10; // Points count
            for (let i = 0; i < length - segmentSize; i += segmentSize) {
                const chunk = timeline.slice(i, i + segmentSize + 1);
                if (chunk.length < 2) continue;

                const avgSpeed = chunk.reduce((acc, p) => acc + p.speed, 0) / chunk.length;

                // Color scale
                let color;
                if (avgSpeed < 80) color = '#0ea5e9';      // Light Blue (Slow)
                else if (avgSpeed < 160) color = '#6366f1'; // Indigo (Mid)
                else color = '#d946ef';                     // Fuchsia (Fast)

                segments.push({
                    points: chunk.map(p => p.position),
                    color: color,
                    width: 5,
                    tooltip: `
                        <div class="tooltip-header" style="color:${color}">Flow Data</div>
                        <div>Speed: <strong>${avgSpeed.toFixed(0)} km/h</strong></div>
                    `
                });
            }
        }
        return segments;
    }

    _computeScales(points) {
        const padding = 60;
        const xExtent = this.d3.extent(points, d => d.x);
        const yExtent = this.d3.extent(points, d => d.y);

        const xRange = xExtent[1] - xExtent[0];
        const yRange = yExtent[1] - yExtent[0];

        const aspect = this.width / this.height;
        const dataAspect = xRange / yRange;

        let xDomain, yDomain;

        if (dataAspect > aspect) {
            const yCenter = (yExtent[0] + yExtent[1]) / 2;
            const newYRange = xRange / aspect;
            yDomain = [yCenter + newYRange / 2, yCenter - newYRange / 2];
            xDomain = [xExtent[0], xExtent[1]];
        } else {
            const xCenter = (xExtent[0] + xExtent[1]) / 2;
            const newXRange = yRange * aspect;
            xDomain = [xCenter - newXRange / 2, xCenter + newXRange / 2];
            yDomain = [yExtent[1], yExtent[0]];
        }

        this.scaleX = this.d3.scaleLinear()
            .domain(xDomain)
            .range([padding, this.width - padding]);

        this.scaleY = this.d3.scaleLinear()
            .domain(yDomain)
            .range([padding, this.height - padding]);
    }

    _lineGenerator() {
        return this.d3.line()
            .x(d => this.scaleX(d.x))
            .y(d => this.scaleY(d.y))
            .curve(this.d3.curveCatmullRom.alpha(0.5));
    }

    _normalizeTimeline(timeline) {
        if (!timeline || !timeline.length) return [];
        return timeline;
    }

    _sampleTelemetry(timeline, time) {
        if (!timeline || timeline.length < 2) return { speed: 0, throttle: 0, brake: 0, distance: 0 };
        let low = 0, high = timeline.length - 1;
        while (low <= high) {
            const mid = (low + high) >>> 1;
            if (timeline[mid].time < time) low = mid + 1;
            else high = mid - 1;
        }
        const idx = Math.max(0, Math.min(high, timeline.length - 2));
        const p1 = timeline[idx];
        const p2 = timeline[idx + 1] || p1;
        const range = p2.time - p1.time;
        const t = range > 0 ? (time - p1.time) / range : 0;
        return {
            speed: this._lerp(p1.speed, p2.speed, t),
            throttle: this._lerp(p1.throttle, p2.throttle, t),
            brake: this._lerp(p1.brake, p2.brake, t),
            distance: this._lerp(p1.distance, p2.distance, t),
            position: {
                x: this._lerp(p1.position.x, p2.position.x, t),
                z: this._lerp(p1.position.z, p2.position.z, t)
            }
        };
    }

    _lerp(a, b, t) { return a + (b - a) * t; }

    _injectDefs() { }

    _createTooltip() {
        const tip = document.createElement('div');
        tip.className = 'analysis-tooltip';
        document.body.appendChild(tip);
        return tip;
    }

    _showTooltip(event, htmlContent) {
        if (!htmlContent) return;

        this.tooltip.innerHTML = htmlContent;

        // Offset slightly from cursor to avoid covering it
        const offsetX = 20;
        const offsetY = 20;

        // Check boundaries
        let left = event.pageX + offsetX;
        let top = event.pageY + offsetY;

        // Flip if too close to right edge
        if (left + 280 > window.innerWidth) {
            left = event.pageX - 300;
        }

        this.tooltip.style.left = `${left}px`;
        this.tooltip.style.top = `${top}px`;
        this.tooltip.classList.add('visible');
    }

    _hideTooltip() {
        this.tooltip.classList.remove('visible');
    }

    _onResize() {
        this.width = this.container.clientWidth || window.innerWidth;
        this.height = this.container.clientHeight || window.innerHeight;
        this.svg.attr('viewBox', `0 0 ${this.width} ${this.height}`);
    }

    setVisualLapTime(seconds) {
        if (seconds > 1) this.visualLapTime = seconds;
    }
}