class Track2DViewer {
    constructor({ containerId, playButtonId, resetButtonId }) {
        this.container = document.getElementById(containerId);
        this.playButton = document.getElementById(playButtonId);
        this.resetButton = document.getElementById(resetButtonId);
        this.userPoints = [];
        this.goldenPoints = [];
        this.userArcLengths = [];
        this._rawUserTelemetry = [];
        this._rawGoldenTelemetry = [];
        this._rawRecommendations = [];
        this.hotZoneData = null;
        this.mode = 'comparison';
        this.heatmapSegments = null;
        this.sectorSize = 200;
        this.ghostSets = [];
        this._rawGhosts = [];
        this.currentGhostPoints = [];
        this.flowSpeedRange = { min: 0, max: 1 };
        this.flowStateThresholds = null;
        this.isPlaying = false;
        this.animationFrame = null;
        this.playbackDuration = 15000;

        if (!this.container) {
            console.error('Track container not found');
            return;
        }

        this.width = this.container.clientWidth;
        this.height = this.container.clientHeight;

        this.svg = d3.select(this.container)
            .append('svg')
            .attr('width', '100%')
            .attr('height', '100%')
            .attr('viewBox', `0 0 ${this.width} ${this.height}`);

        this.background = this.svg.append('rect')
            .attr('x', 0)
            .attr('y', 0)
            .attr('width', '100%')
            .attr('height', '100%')
            .attr('fill', 'rgba(15, 23, 42, 0.9)');

        this.defs = this.svg.append('defs');
        const glowFilter = this.defs.append('filter')
            .attr('id', 'track-glow')
            .attr('height', '300%')
            .attr('width', '300%')
            .attr('x', '-100%')
            .attr('y', '-100%');
        glowFilter.append('feGaussianBlur')
            .attr('stdDeviation', 6)
            .attr('result', 'coloredBlur');
        const feMerge = glowFilter.append('feMerge');
        feMerge.append('feMergeNode').attr('in', 'coloredBlur');
        feMerge.append('feMergeNode').attr('in', 'SourceGraphic');

        this.mainGroup = this.svg.append('g').attr('class', 'track-layer');
        this.highlightGroup = this.mainGroup.append('g').attr('class', 'highlight-layer');
        this.lineGroup = this.mainGroup.append('g').attr('class', 'lines-layer');
        this.markerGroup = this.mainGroup.append('g').attr('class', 'marker-layer');

        this.zoom = d3.zoom()
            .scaleExtent([0.8, 18])
            .on('zoom', (event) => {
                this.mainGroup.attr('transform', event.transform);
                this.currentTransform = event.transform;
            });

        this.svg.call(this.zoom);
        this.currentTransform = d3.zoomIdentity;

        if (this.playButton) {
            this.playButton.addEventListener('click', () => this.togglePlayback());
        }
        if (this.resetButton) {
            this.resetButton.addEventListener('click', () => this.resetView());
        }
        this.tooltip = document.createElement('div');
        Object.assign(this.tooltip.style, {
            position: 'absolute',
            pointerEvents: 'none',
            background: 'rgba(15,23,42,0.95)',
            border: '1px solid rgba(56,189,248,0.4)',
            color: '#e2e8f0',
            padding: '8px 12px',
            borderRadius: '8px',
            boxShadow: '0 10px 25px rgba(0,0,0,0.35)',
            fontSize: '12px',
            lineHeight: '1.4',
            opacity: '0',
            transform: 'translate(-50%, -120%)',
            transition: 'opacity 0.15s ease'
        });
        this.container.style.position = 'relative';
        this.container.appendChild(this.tooltip);

        this.statusLabel = document.createElement('div');
        Object.assign(this.statusLabel.style, {
            position: 'absolute',
            inset: '0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#a5b4fc',
            fontSize: '14px',
            fontWeight: '600',
            pointerEvents: 'none',
            textShadow: '0 2px 6px rgba(0,0,0,0.6)'
        });
        this.container.appendChild(this.statusLabel);
        this.hideStatus();

        window.addEventListener('resize', () => this.handleResize());
    }

    renderComparison(userTelemetry, goldenTelemetry, recommendations = []) {
        this.mode = 'comparison';
        this._rawRecommendations = recommendations || [];
        this._rawUserTelemetry = userTelemetry || [];
        this._rawGoldenTelemetry = goldenTelemetry || [];
        this.hotZoneData = null;
        this.heatmapSegments = null;
        this.baseRender(userTelemetry, goldenTelemetry);
        this.drawHighlights(this._rawRecommendations);
    }

    renderHeatmap(userTelemetry, hotZones = null) {
        this.mode = 'heatmap';
        this._rawUserTelemetry = userTelemetry || [];
        this._rawGoldenTelemetry = [];
        this._rawRecommendations = [];
        this.hotZoneData = hotZones || null;
        this.baseRender(userTelemetry, []);
    }

    renderHotZonesMap(userTelemetry, hotZones = null) {
        this.mode = 'hotzones';
        this._rawUserTelemetry = userTelemetry || [];
        this._rawGoldenTelemetry = [];
        this._rawRecommendations = [];
        this.hotZoneData = hotZones || null;
        this.baseRender(userTelemetry, []);
    }

    renderFlowDynamics(userTelemetry) {
        this.mode = 'flow';
        this._rawUserTelemetry = userTelemetry || [];
        this._rawGoldenTelemetry = [];
        this._rawRecommendations = [];
        this.hotZoneData = null;
        this.baseRender(userTelemetry, []);
    }

    renderGhosts(userTelemetry, ghosts = []) {
        this.mode = 'ghosts';
        this._rawUserTelemetry = userTelemetry || [];
        this._rawGoldenTelemetry = [];
        this._rawRecommendations = [];
        this.hotZoneData = null;
        this._rawGhosts = ghosts || [];
        this.ghostSets = this._rawGhosts.map((ghost, index) => ({
            label: ghost.label || `Lap ${ghost.lap}`,
            lap: ghost.lap,
            lap_time: ghost.lap_time,
            points: this.prepareExternalTelemetry(ghost.telemetry || []),
            color: this.pickGhostColor(index)
        })).filter(g => g.points.length);
        this.baseRender(userTelemetry, []);
    }

    render(userTelemetry, goldenTelemetry, recommendations = []) {
        this.renderComparison(userTelemetry, goldenTelemetry, recommendations);
    }

    baseRender(userTelemetry, goldenTelemetry) {
        if (!this.container) return;

        this.stopPlayback(true);

        this.userPoints = this.prepareTelemetry(userTelemetry);
        this.goldenPoints = this.prepareTelemetry(goldenTelemetry);
        this.userArcLengths = this.computeArcLengths(this.userPoints);
        this.currentGhostPoints = [];
        if (this.mode === 'ghosts') {
            this.currentGhostPoints = this.ghostSets.reduce((acc, ghost) => acc.concat(ghost.points), []);
            this.heatmapSegments = null;
        } else if (this.mode !== 'comparison') {
            this.heatmapSegments = this.buildHeatmapSegments(this.userPoints, this.hotZoneData);
        } else {
            this.heatmapSegments = null;
        }

        if (!this.userPoints.length) {
            this.lineGroup.selectAll('*').remove();
            this.highlightGroup.selectAll('*').remove();
            this.markerGroup.selectAll('*').remove();
            this.showStatus('No telemetry coordinates available for this lap.');
            return;
        }
        this.hideStatus();

        this.updateDimensions();
        this.computeScales();
        this.drawPaths();
        if (this.mode === 'comparison') {
            this.drawHighlights(this._rawRecommendations);
        } else {
            this.highlightGroup.selectAll('*').remove();
        }
        this.resetView(false);
    }

    prepareTelemetry(telemetry = []) {
        return telemetry
            .filter(point =>
                typeof point?.VBOX_Long_Minutes === 'number' &&
                typeof point?.VBOX_Lat_Min === 'number' &&
                typeof point?.Laptrigger_lapdist_dls === 'number'
            )
            .map(point => ({
                x: Number(point.VBOX_Long_Minutes),
                y: Number(point.VBOX_Lat_Min),
                distance: Number(point.Laptrigger_lapdist_dls),
                speed: Number(point.Speed ?? 0)
            }))
            .sort((a, b) => a.distance - b.distance);
    }

    prepareExternalTelemetry(telemetry = []) {
        return telemetry
            .filter(point =>
                typeof point?.lon === 'number' &&
                typeof point?.lat === 'number' &&
                typeof point?.distance === 'number'
            )
            .map(point => ({
                x: Number(point.lon),
                y: Number(point.lat),
                distance: Number(point.distance),
                speed: typeof point.speed === 'number' ? Number(point.speed) : null
            }))
            .sort((a, b) => a.distance - b.distance);
    }

    computeArcLengths(points = []) {
        if (!points.length) return [];
        const lengths = [0];
        let total = 0;
        for (let i = 1; i < points.length; i++) {
            const dx = points[i].x - points[i - 1].x;
            const dy = points[i].y - points[i - 1].y;
            total += Math.sqrt(dx * dx + dy * dy);
            lengths.push(total);
        }
        return lengths;
    }

    getSpeedAtArcLength(targetLength) {
        if (!this.userArcLengths || !this.userArcLengths.length) return null;
        const total = this.userArcLengths[this.userArcLengths.length - 1];
        if (total === 0) return this.userPoints[0]?.speed ?? null;
        const clamped = Math.max(0, Math.min(targetLength, total));
        let low = 0;
        let high = this.userArcLengths.length - 1;
        while (low < high) {
            const mid = Math.floor((low + high) / 2);
            if (this.userArcLengths[mid] < clamped) {
                low = mid + 1;
            } else {
                high = mid;
            }
        }
        return this.userPoints[low]?.speed ?? null;
    }

    updateDimensions() {
        const newWidth = this.container.clientWidth || this.width;
        const newHeight = this.container.clientHeight || this.height;

        if (newWidth !== this.width || newHeight !== this.height) {
            this.width = newWidth;
            this.height = newHeight;
            this.svg.attr('viewBox', `0 0 ${this.width} ${this.height}`);
        }
    }

    computeScales() {
        const padding = 30;
        const combined = [...this.userPoints, ...this.goldenPoints, ...this.currentGhostPoints];

        const xExtent = d3.extent(combined, d => d.x);
        const yExtent = d3.extent(combined, d => d.y);

        const xPad = (xExtent[1] - xExtent[0]) * 0.05 || 0.0005;
        const yPad = (yExtent[1] - yExtent[0]) * 0.05 || 0.0005;

        this.scaleX = d3.scaleLinear()
            .domain([xExtent[0] - xPad, xExtent[1] + xPad])
            .range([padding, this.width - padding]);

        this.scaleY = d3.scaleLinear()
            .domain([yExtent[1] + yPad, yExtent[0] - yPad])
            .range([padding, this.height - padding]);

        this.lineGenerator = d3.line()
            .x(d => this.scaleX(d.x))
            .y(d => this.scaleY(d.y))
            .curve(d3.curveCatmullRom.alpha(0.5));
    }

    drawPaths() {
        this.lineGroup.selectAll('*').remove();

        if (this.mode === 'flow') {
            this.drawFlowVisualization();
            return;
        } else if (this.mode === 'ghosts') {
            this.lineGroup.append('path')
                .datum(this.userPoints)
                .attr('d', this.lineGenerator)
                .attr('stroke', '#ef4444')
                .attr('stroke-width', 4)
                .attr('fill', 'none')
                .attr('opacity', 0.9);

            if (this.ghostSets.length) {
                this.ghostSets.forEach(ghost => {
                    this.lineGroup.append('path')
                        .datum(ghost.points)
                        .attr('d', this.lineGenerator)
                        .attr('stroke', ghost.color)
                        .attr('stroke-dasharray', '6 6')
                        .attr('stroke-width', 3)
                        .attr('fill', 'none')
                        .attr('opacity', 0.8);
                });
                this.hideStatus();
            } else {
                this.showStatus('No alternate laps available for ghost comparison.');
            }
        } else if (this.mode !== 'comparison') {
            if (this.heatmapSegments && this.heatmapSegments.length) {
                this.heatmapSegments.forEach(segment => {
                    const path = this.lineGroup.append('path')
                        .datum(segment.points)
                        .attr('d', this.lineGenerator)
                        .attr('stroke', segment.color)
                        .attr('stroke-width', 6)
                        .attr('fill', 'none')
                        .attr('opacity', 0.9);

                    if (segment.info) {
                        path.style('cursor', 'pointer')
                            .on('mousemove', (event) => this.showHeatmapTooltip(event, segment.info))
                            .on('mouseleave', () => this.hideTooltip());
                    }
                });
                this.hideStatus();
            } else {
                this.lineGroup.append('path')
                    .datum(this.userPoints)
                    .attr('d', this.lineGenerator)
                    .attr('stroke', '#94a3b8')
                    .attr('stroke-width', 3)
                    .attr('fill', 'none')
                    .attr('opacity', 0.5);
                this.showStatus('Not enough data to draw this map.');
            }
        } else {
            this.lineGroup.append('path')
                .datum(this.goldenPoints)
                .attr('d', this.lineGenerator)
                .attr('stroke', '#facc15')
                .attr('stroke-width', 3)
                .attr('fill', 'none')
                .attr('opacity', 0.9);

            this.lineGroup.append('path')
                .datum(this.userPoints)
                .attr('d', this.lineGenerator)
                .attr('stroke', '#ef4444')
                .attr('stroke-width', 4)
                .attr('fill', 'none')
                .attr('opacity', 0.95);
            if (!this.goldenPoints.length) {
                this.showStatus('Golden lap path unavailable for this circuit.');
            } else {
                this.hideStatus();
            }
        }

        this.drawMarkers();
    }

    drawHighlights(recommendations = []) {
        this.highlightGroup.selectAll('*').remove();

        if (!recommendations.length) {
            return;
        }

        const sectorSpread = 150; // meters on each side of the target distance

        recommendations.forEach((rec, index) => {
            const target = rec.distance || 0;
            const segment = this.userPoints.filter(point =>
                Math.abs(point.distance - target) <= sectorSpread
            );

            if (segment.length < 2) return;

            const segmentPath = this.highlightGroup.append('path')
                .datum(segment)
                .attr('d', this.lineGenerator)
                .attr('stroke', '#38bdf8')
                .attr('stroke-width', 8)
                .attr('stroke-linecap', 'round')
                .attr('stroke-linejoin', 'round')
                .attr('fill', 'none')
                .attr('opacity', 0.6)
                .attr('filter', 'url(#track-glow)')
                .style('cursor', 'pointer')
                .on('mousemove', (event) => this.showTooltip(event, rec))
                .on('mouseleave', () => this.hideTooltip());

            const midPoint = segment[Math.floor(segment.length / 2)];
            this.highlightGroup.append('circle')
                .attr('cx', this.scaleX(midPoint.x))
                .attr('cy', this.scaleY(midPoint.y))
                .attr('r', 6)
                .attr('fill', '#38bdf8')
                .attr('stroke', '#0f172a')
                .attr('stroke-width', 2)
                .style('cursor', 'pointer')
                .on('mousemove', (event) => this.showTooltip(event, rec))
                .on('mouseleave', () => this.hideTooltip());
        });
    }

    buildHeatmapSegments(points, hotZones) {
        if (!hotZones || !hotZones.sectors || !points.length) return null;
        const sectorMap = {};
        hotZones.sectors.forEach(sector => {
            sectorMap[sector.sector] = sector;
        });

        const segments = [];
        let current = null;
        points.forEach(point => {
            const sectorId = Math.floor(point.distance / this.sectorSize);
            const info = sectorMap[sectorId];
            const color = this.getSegmentColor(info);
            const key = `${color}-${info ? info.sector : 'none'}`;
            if (!current || current.key !== key) {
                current = { color, points: [], info, key };
                segments.push(current);
            }
            current.points.push(point);
        });
        return segments.filter(seg => seg.points.length > 1);
    }

    getSegmentColor(info) {
        if (this.mode === 'hotzones') {
            if (!info) return '#475569';
            if (info.rating === 'weak') return '#ef4444';
            if (info.rating === 'excellent') return '#10b981';
            if (info.rating === 'good') return '#facc15';
            return '#94a3b8';
        }
        const variance = info ? info.variance : 0;
        return this.getHeatColor(variance);
    }

    getHeatColor(variance) {
        if (variance < 1.5) {
            return '#10b981';
        }
        if (variance < 3.5) {
            return '#facc15';
        }
        if (variance < 7) {
            return '#fb923c';
        }
        return '#ef4444';
    }

    getHeatLabel(rating) {
        switch ((rating || '').toLowerCase()) {
            case 'excellent':
                return 'EXCELLENT';
            case 'good':
                return 'GOOD';
            case 'ok':
                return 'OK';
            case 'weak':
                return 'WEAK';
            default:
                return 'N/A';
        }
    }

    getHeatLabelColor(rating) {
        switch ((rating || '').toLowerCase()) {
            case 'excellent':
                return '#10b981';
            case 'good':
                return '#facc15';
            case 'ok':
                return '#fb923c';
            case 'weak':
                return '#ef4444';
            default:
                return '#94a3b8';
        }
    }

    drawFlowVisualization() {
        if (!this.userPoints.length) {
            this.showStatus('No telemetry coordinates available for this lap.');
            return;
        }

        const speeds = this.userPoints
            .map(p => (typeof p.speed === 'number' ? p.speed : null))
            .filter(speed => speed != null);

        if (!speeds.length) {
            this.showStatus('Speed data unavailable.');
            return;
        }

        const minSpeed = Math.min(...speeds);
        const maxSpeed = Math.max(...speeds);

        this.flowSpeedRange = { min: minSpeed, max: maxSpeed };
        this.flowStateThresholds = this.computeFlowThresholds(speeds);

        for (let i = 0; i < this.userPoints.length - 1; i++) {
            const segment = [this.userPoints[i], this.userPoints[i + 1]];
            const speed = segment[0].speed ?? segment[1].speed ?? minSpeed;
            const state = this.getFlowState(speed, minSpeed, maxSpeed);
            const color = state.color;
            this.lineGroup.append('path')
                .datum(segment)
                .attr('d', this.lineGenerator)
                .attr('stroke', color)
                .attr('stroke-width', 5)
                .attr('stroke-linecap', 'round')
                .attr('fill', 'none')
                .attr('opacity', 0.9)
                .style('cursor', 'pointer')
                .on('mousemove', (event) => this.showFlowTooltip(event, { speed, state }))
                .on('mouseleave', () => this.hideTooltip());
        }

        this.hideStatus();
    }

    getFlowColor(speed, min, max) {
        return this.getFlowState(speed, min, max).color;
    }

    getFlowState(speed, min = this.flowSpeedRange.min, max = this.flowSpeedRange.max) {
        const thresholds = this.flowStateThresholds;
        if (isFinite(speed) && thresholds) {
            const fastCutoff = thresholds.fast ?? thresholds.slow ?? speed;
            const slowCutoff = thresholds.slow ?? thresholds.fast ?? speed;
            if (speed >= fastCutoff) {
                return { label: 'Fast flow', color: '#22d3ee' };
            }
            if (speed >= slowCutoff) {
                return { label: 'Balanced', color: '#facc15' };
            }
            return { label: 'Slow zone', color: '#f97316' };
        }

        const ratio = this.computeFlowMomentum(speed, min, max);
        if (ratio != null && ratio >= 0.66) return { label: 'Fast flow', color: '#22d3ee' };
        if (ratio != null && ratio >= 0.33) return { label: 'Balanced', color: '#facc15' };
        return { label: 'Slow zone', color: '#f97316' };
    }

    computeFlowMomentum(speed, min = this.flowSpeedRange?.min ?? 0, max = this.flowSpeedRange?.max ?? 0) {
        if (!isFinite(speed)) return null;
        const range = Math.max(max - min, 0);
        if (range === 0) return null;
        const ratio = (speed - min) / range;
        return Math.max(0, Math.min(1, ratio));
    }

    computeFlowThresholds(values = []) {
        const valid = values.filter(value => typeof value === 'number' && isFinite(value));
        if (!valid.length) return null;
        const sorted = [...valid].sort((a, b) => a - b);
        const slowIndex = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.33));
        const fastIndex = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.66));
        return {
            slow: sorted[slowIndex],
            fast: sorted[fastIndex]
        };
    }

    drawMarkers() {
        this.markerGroup.selectAll('*').remove();

        this.userMarker = this.markerGroup.append('circle')
            .attr('r', 6)
            .attr('fill', '#ef4444')
            .attr('stroke', '#fff')
            .attr('stroke-width', 2);

        if (this.mode === 'comparison' && this.goldenPoints.length) {
            this.goldenMarker = this.markerGroup.append('circle')
                .attr('r', 6)
                .attr('fill', '#facc15')
                .attr('stroke', '#0f172a')
                .attr('stroke-width', 2);
        } else {
            this.goldenMarker = null;
        }

        this.updateMarkerPositions(0);
    }

    togglePlayback() {
        if (this.isPlaying) {
            this.stopPlayback();
        } else {
            this.startPlayback();
        }
    }

    startPlayback() {
        if (!this.userPoints.length || this.mode !== 'comparison' || !this.goldenPoints.length) return;

        this.isPlaying = true;
        if (this.playButton) {
            this.playButton.innerHTML = '<span>⏸️</span><span>Pause Replay</span>';
        }

        const animate = (timestamp) => {
            if (!this.playbackStart) {
                this.playbackStart = timestamp;
            }

            const elapsed = timestamp - this.playbackStart;
            const progress = Math.min(elapsed / this.playbackDuration, 1);

            this.updateMarkerPositions(progress);

            if (progress < 1 && this.isPlaying) {
                this.animationFrame = requestAnimationFrame(animate);
            } else {
                this.stopPlayback(false);
            }
        };

        this.animationFrame = requestAnimationFrame(animate);
    }

    stopPlayback(resetProgress = true) {
        this.isPlaying = false;
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }
        this.playbackStart = null;
        if (resetProgress) {
            this.updateMarkerPositions(0);
        }
        if (this.playButton) {
            this.playButton.innerHTML = '<span>▶️</span><span>Play Lap Replay</span>';
        }
    }

    updateMarkerPositions(progress) {
        const userPoint = this.pointAtProgress(this.userPoints, progress);
        const goldenPoint = this.pointAtProgress(this.goldenPoints, progress);

        if (userPoint && this.userMarker) {
            this.userMarker
                .attr('cx', this.scaleX(userPoint.x))
                .attr('cy', this.scaleY(userPoint.y));
        }

        if (goldenPoint && this.goldenMarker) {
            this.goldenMarker
                .attr('cx', this.scaleX(goldenPoint.x))
                .attr('cy', this.scaleY(goldenPoint.y));
        }

    }

    pointAtProgress(points, progress) {
        if (!points.length) return null;
        const clamped = Math.max(0, Math.min(1, progress));
        const index = Math.floor(clamped * (points.length - 1));
        return points[index];
    }

    resetView(animate = true) {
        const resetFn = () => {
            this.mainGroup.attr('transform', d3.zoomIdentity);
            this.currentTransform = d3.zoomIdentity;
        };

        if (animate) {
            this.svg.transition()
                .duration(600)
                .call(this.zoom.transform, d3.zoomIdentity)
                .end()
                .catch(() => {})
                .finally(resetFn);
        } else {
            this.svg.call(this.zoom.transform, d3.zoomIdentity);
            resetFn();
        }
    }

    handleResize() {
        if (!this.container || !this.userPoints.length) return;
        if (this.mode === 'heatmap') {
            this.renderHeatmap(this._rawUserTelemetry, this.hotZoneData);
        } else if (this.mode === 'flow') {
            this.renderFlowDynamics(this._rawUserTelemetry);
        } else if (this.mode === 'ghosts') {
            this.renderGhosts(this._rawUserTelemetry, this._rawGhosts);
        } else if (this.mode === 'hotzones') {
            this.renderHotZonesMap(this._rawUserTelemetry, this.hotZoneData);
        } else {
            this.renderComparison(this._rawUserTelemetry, this._rawGoldenTelemetry, this._rawRecommendations);
        }
    }

    renderTooltip(event, html) {
        if (!this.tooltip) return;
        const { clientX, clientY } = event;
        const rect = this.container.getBoundingClientRect();
        this.tooltip.innerHTML = html;
        this.tooltip.style.opacity = '1';
        this.tooltip.style.left = `${clientX - rect.left}px`;
        this.tooltip.style.top = `${clientY - rect.top - 12}px`;
    }

    showTooltip(event, rec) {
        const html = `
            <div class="font-semibold text-sky-300 text-sm mb-1">Segment ${rec.sector}</div>
            <div class="text-xs text-gray-300">Distance ~${Math.round(rec.distance)} m</div>
            <div class="text-xs text-red-300 mt-1">⚠️ ${rec.issue}</div>
            <div class="text-xs text-emerald-300">💡 ${rec.suggestion}</div>
                <div class="text-xs text-gray-400 mt-1">Gain: ${rec.estimated_gain.toFixed(2)} s • Loss: ${rec.speed_loss.toFixed(1)} km/h</div>
        `;
        this.renderTooltip(event, html);
    }

    showHeatmapTooltip(event, info) {
        if (!info) return;
        const ratingLabel = this.getHeatLabel(info.rating);
        const color = this.getHeatLabelColor(info.rating);
        const html = `
            <div class="font-semibold text-sky-300 text-sm mb-1">Sector ${info.sector}</div>
            <div class="text-xs text-gray-300">Variance: ${info.variance.toFixed(2)} km/h²</div>
            <div class="text-xs text-gray-300">Avg speed: ${info.avg_speed?.toFixed(1) || '—'} km/h</div>
            <div class="text-xs mt-1" style="color:${color}">${ratingLabel}</div>
        `;
        this.renderTooltip(event, html);
    }

    showFlowTooltip(event, data) {
        if (!data) return;
        const state = data.state || this.getFlowState(data.speed, this.flowSpeedRange?.min ?? 0, this.flowSpeedRange?.max ?? 0);
        const color = state?.color || '#22d3ee';
        const label = state?.label || 'Flow';
        const momentum = this.computeFlowMomentum(data.speed);
        const pctText = typeof momentum === 'number' ? `${Math.round(momentum * 100)}% momentum` : '';
        const html = `
            <div class="font-semibold text-sm mb-1" style="color:${color}">${label}</div>
            <div class="text-xs text-gray-300">Speed: ${data.speed?.toFixed(1) || '—'} km/h</div>
            ${pctText ? `<div class="text-xs text-gray-400">${pctText}</div>` : ''}
        `;
        this.renderTooltip(event, html);
    }

    hideTooltip() {
        if (this.tooltip) {
            this.tooltip.style.opacity = '0';
        }
    }

    showStatus(message) {
        if (this.statusLabel) {
            this.statusLabel.textContent = message;
            this.statusLabel.style.opacity = '1';
        }
    }

    hideStatus() {
        if (this.statusLabel) {
            this.statusLabel.style.opacity = '0';
        }
    }

    pickGhostColor(index) {
        const palette = ['#38bdf8', '#f472b6', '#22d3ee', '#c084fc'];
        return palette[index % palette.length];
    }
}
