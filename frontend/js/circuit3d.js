// Circuit 3D Visualizer
class Circuit3DViewer {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.userCar = null;
        this.goldenCar = null;
        this.animationId = null;

        this.init();
    }

    init() {
        // Scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x1a2332);
        this.scene.fog = new THREE.Fog(0x1a2332, 200, 500);

        // Camera
        this.camera = new THREE.PerspectiveCamera(
            60,
            this.container.offsetWidth / this.container.offsetHeight,
            0.1,
            10000
        );
        this.camera.position.set(0, 100, 150);
        this.camera.lookAt(0, 0, 0);

        // Renderer
        this.renderer = new THREE.WebGLRenderer({
            antialias: true,
            alpha: true
        });
        this.renderer.setSize(this.container.offsetWidth, this.container.offsetHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.container.appendChild(this.renderer.domElement);

        // Orbit controls for smooth zoom/pan/rotation
        this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.08;
        this.controls.enablePan = true;
        this.controls.screenSpacePanning = false;
        this.controls.rotateSpeed = 0.6;
        this.controls.zoomSpeed = 0.8;
        this.controls.panSpeed = 0.6;
        this.controls.minDistance = 30;
        this.controls.maxDistance = 5000;
        this.controls.maxPolarAngle = Math.PI / 2 - 0.1;
        this.controls.target.set(0, 0, 0);

        // Lights
        const ambientLight = new THREE.AmbientLight(0xffffff, 1.0);
        this.scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 1.5);
        directionalLight.position.set(100, 200, 100);
        directionalLight.castShadow = true;
        directionalLight.shadow.camera.left = -500;
        directionalLight.shadow.camera.right = 500;
        directionalLight.shadow.camera.top = 500;
        directionalLight.shadow.camera.bottom = -500;
        this.scene.add(directionalLight);

        const hemisphereLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.8);
        this.scene.add(hemisphereLight);

        // Ground
        const groundGeometry = new THREE.PlaneGeometry(10000, 10000);
        const groundMaterial = new THREE.MeshLambertMaterial({
            color: 0x1e293b,
            side: THREE.DoubleSide
        });
        const ground = new THREE.Mesh(groundGeometry, groundMaterial);
        ground.rotation.x = -Math.PI / 2;
        ground.position.y = -1;
        ground.receiveShadow = true;
        this.scene.add(ground);

        // Grid helper
        const gridHelper = new THREE.GridHelper(10000, 200, 0x64748b, 0x334155);
        gridHelper.position.y = 0;
        this.scene.add(gridHelper);

        // Axes helper (debug)
        const axesHelper = new THREE.AxesHelper(500);
        this.scene.add(axesHelper);

        console.log('✅ Scene initialized');

        // Handle resize
        window.addEventListener('resize', () => this.onWindowResize());

        // Start render loop
        this.animate();
    }

    createCircuit(userTelemetry, goldenTelemetry) {
        console.log('Creating 3D circuit...');
        console.log('User telemetry points:', userTelemetry.length);
        console.log('Golden telemetry points:', goldenTelemetry.length);

        // Clear previous circuit
        this.clearCircuit();

        if (!userTelemetry || userTelemetry.length === 0 || !goldenTelemetry || goldenTelemetry.length === 0) {
            console.error('Invalid telemetry data');
            return;
        }

        // Normalize GPS coordinates
        const centerLon = userTelemetry[0].VBOX_Long_Minutes;
        const centerLat = userTelemetry[0].VBOX_Lat_Min;
        const scale = 500000;

        // Create user path
        const userPoints = userTelemetry.map(point => {
            const x = (point.VBOX_Long_Minutes - centerLon) * scale;
            const z = (point.VBOX_Lat_Min - centerLat) * scale;
            return new THREE.Vector3(x, 0.2, z);
        });

        const goldenPoints = goldenTelemetry.map(point => {
            const x = (point.VBOX_Long_Minutes - centerLon) * scale;
            const z = (point.VBOX_Lat_Min - centerLat) * scale;
            return new THREE.Vector3(x, 0.2, z);
        });

        // Create circuit base
        const avgPoints = userPoints.map((p, i) => {
            if (i < goldenPoints.length) {
                return new THREE.Vector3(
                    (p.x + goldenPoints[i].x) / 2,
                    0.1,
                    (p.z + goldenPoints[i].z) / 2
                );
            }
            return p;
        });

        try {
            // Circuit track (tube)
            const curve = new THREE.CatmullRomCurve3(avgPoints, false);
            const tubeGeometry = new THREE.TubeGeometry(curve, Math.min(avgPoints.length * 2, 512), 2, 8, false);
            const tubeMaterial = new THREE.MeshStandardMaterial({
                color: 0x475569,
                emissive: 0x1e293b,
                emissiveIntensity: 0.3,
                roughness: 0.7,
                metalness: 0.3
            });
            const track = new THREE.Mesh(tubeGeometry, tubeMaterial);
            track.castShadow = true;
            track.receiveShadow = true;
            this.scene.add(track);

            console.log('✅ Track created');

            // User path line (red)
            const userLineGeometry = new THREE.BufferGeometry().setFromPoints(userPoints);
            const userLineMaterial = new THREE.LineBasicMaterial({
                color: 0xff0000,
                linewidth: 3
            });
            const userLine = new THREE.Line(userLineGeometry, userLineMaterial);
            userLine.position.y = 1;
            this.scene.add(userLine);

            console.log('✅ User line created');

            // Golden path line (yellow)
            const goldenLineGeometry = new THREE.BufferGeometry().setFromPoints(goldenPoints);
            const goldenLineMaterial = new THREE.LineBasicMaterial({
                color: 0xffff00,
                linewidth: 3
            });
            const goldenLine = new THREE.Line(goldenLineGeometry, goldenLineMaterial);
            goldenLine.position.y = 1.5;
            this.scene.add(goldenLine);

            console.log('✅ Golden line created');

            // Speed heatmap
            const sampleRate = Math.max(1, Math.floor(userPoints.length / 50));
            for (let i = 0; i < userPoints.length; i += sampleRate) {
                const speed = userTelemetry[i].Speed;
                const color = this.getSpeedColor(speed);

                const sphereGeometry = new THREE.SphereGeometry(5, 16, 16);
                const sphereMaterial = new THREE.MeshBasicMaterial({
                    color: color,
                    transparent: true,
                    opacity: 0.8
                });
                const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial);

                sphere.position.copy(userPoints[i]);
                sphere.position.y = 10;
                this.scene.add(sphere);
            }

            console.log('✅ Heatmap created');

            // Create cars
            this.createCars(userPoints[0], goldenPoints[0]);

            console.log('✅ Cars created');

            // Adjust camera
            this.fitCameraToCircuit(avgPoints);

            console.log('✅ Camera fitted');

        } catch (error) {
            console.error('❌ Error creating circuit:', error);
        }

        console.log('✅ Circuit created');
    }

    createPathLine(points, color, linewidth) {
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const material = new THREE.LineBasicMaterial({
            color: color,
            linewidth: linewidth,
            transparent: true,
            opacity: 0.8
        });
        const line = new THREE.Line(geometry, material);
        this.scene.add(line);
    }

    createSpeedHeatmap(points, telemetry) {
        // Create colored spheres along the path based on speed
        for (let i = 0; i < points.length; i += 10) { // Every 10th point
            const speed = telemetry[i].Speed;
            const color = this.getSpeedColor(speed);

            const sphereGeometry = new THREE.SphereGeometry(1.5, 8, 8);
            const sphereMaterial = new THREE.MeshBasicMaterial({ color: color });
            const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial);

            sphere.position.copy(points[i]);
            sphere.position.y = 3;
            this.scene.add(sphere);
        }
    }

    getSpeedColor(speed) {
        // Speed to color gradient: Red (slow) -> Yellow -> Green (fast)
        if (speed < 50) return 0xef4444;      // Red
        if (speed < 80) return 0xf59e0b;      // Orange
        if (speed < 110) return 0xfbbf24;     // Yellow
        if (speed < 140) return 0x84cc16;     // Light green
        return 0x22c55e;                       // Green
    }

    createCars(userStartPos, goldenStartPos) {
        // User car (red) - DIMENSIONS RÉDUITES
        const userGroup = new THREE.Group();

        const userBody = new THREE.Mesh(
            new THREE.BoxGeometry(1.5, 0.8, 2.5),
            new THREE.MeshLambertMaterial({ color: 0xef4444 })
        );
        userBody.position.y = 0.4;
        userBody.castShadow = true;
        userGroup.add(userBody);

        const userTop = new THREE.Mesh(
            new THREE.BoxGeometry(1.2, 0.5, 1.5),
            new THREE.MeshLambertMaterial({ color: 0xdc2626 })
        );
        userTop.position.y = 0.9;
        userTop.castShadow = true;
        userGroup.add(userTop);

        userGroup.position.copy(userStartPos);
        this.scene.add(userGroup);
        this.userCar = userGroup;

        // Golden car (yellow)
        const goldenGroup = new THREE.Group();

        const goldenBody = new THREE.Mesh(
            new THREE.BoxGeometry(1.5, 0.8, 2.5),
            new THREE.MeshLambertMaterial({ color: 0xfbbf24 })
        );
        goldenBody.position.y = 0.4;
        goldenBody.castShadow = true;
        goldenGroup.add(goldenBody);

        const goldenTop = new THREE.Mesh(
            new THREE.BoxGeometry(1.2, 0.5, 1.5),
            new THREE.MeshLambertMaterial({ color: 0xf59e0b })
        );
        goldenTop.position.y = 0.9;
        goldenTop.castShadow = true;
        goldenGroup.add(goldenTop);

        goldenGroup.position.copy(goldenStartPos);
        this.scene.add(goldenGroup);
        this.goldenCar = goldenGroup;
    }

    fitCameraToCircuit(points) {
        if (!points || points.length === 0) {
            return;
        }

        const boundingBox = new THREE.Box3().setFromPoints(points);
        const size = boundingBox.getSize(new THREE.Vector3());
        const center = boundingBox.getCenter(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.z, 1);

        // Calculate distance so the whole track fits in view
        const fitHeightDistance = maxDim / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)));
        const distance = fitHeightDistance * 1.2;
        const direction = new THREE.Vector3(1, 0.6, 1).normalize();
        const newPosition = center.clone().add(direction.multiplyScalar(distance));

        this.camera.position.copy(newPosition);
        this.camera.near = 0.1;
        this.camera.far = Math.max(1000, maxDim * 10);
        this.camera.updateProjectionMatrix();

        if (this.controls) {
            this.controls.target.copy(center);
            this.controls.minDistance = Math.max(20, maxDim * 0.1);
            this.controls.maxDistance = Math.max(300, maxDim * 5);
            this.controls.update();
        }

        console.log('✅ Camera fitted to circuit center:', center);
    }

    clearCircuit() {
        // Remove all meshes except ground and grid
        const objectsToRemove = [];
        this.scene.traverse((object) => {
            if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
                if (object.geometry && object.geometry.type !== 'PlaneGeometry') {
                    objectsToRemove.push(object);
                }
            }
        });

        objectsToRemove.forEach(obj => {
            this.scene.remove(obj);
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) obj.material.dispose();
        });

        this.userCar = null;
        this.goldenCar = null;
    }

    animate() {
        this.animationId = requestAnimationFrame(() => this.animate());

        // Log
        if (!this._loggedOnce) {
            console.log('🎬 Animation running, scene children:', this.scene.children.length);
            this._loggedOnce = true;
        }

        if (this.controls) {
            this.controls.update();
        }

        // Slight car bounce
        if (this.userCar) {
            this.userCar.position.y = 0.2 + Math.sin(Date.now() * 0.003) * 0.1;
        }
        if (this.goldenCar) {
            this.goldenCar.position.y = 0.2 + Math.cos(Date.now() * 0.003) * 0.1;
        }

        this.renderer.render(this.scene, this.camera);
    }

    onWindowResize() {
        this.camera.aspect = this.container.offsetWidth / this.container.offsetHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(this.container.offsetWidth, this.container.offsetHeight);
        if (this.controls) {
            this.controls.update();
        }
    }

    destroy() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
        }
        if (this.controls) {
            this.controls.dispose();
        }
        this.renderer.dispose();
        this.container.removeChild(this.renderer.domElement);
    }

}

// Global instance
let circuit3D = null;

function init3DCircuit(userTelemetry, goldenTelemetry) {

    console.log('=== INIT 3D CIRCUIT ===');
    console.log('Received user telemetry:', userTelemetry?.length || 'undefined');
    console.log('Received golden telemetry:', goldenTelemetry?.length || 'undefined');
    console.log('Type of user:', typeof userTelemetry);
    console.log('Is array?', Array.isArray(userTelemetry));

    const container = document.getElementById('circuit-3d-container');

    if (!container) {
        console.error('3D container not found');
        return;
    }

    // Create viewer if not exists
    if (!circuit3D) {
        circuit3D = new Circuit3DViewer('circuit-3d-container');
    }

    // Create circuit
    circuit3D.createCircuit(userTelemetry, goldenTelemetry);
}
