// 3D view for エキストラ mode. extra.html の立方格子と軸ナビゲーターがベースです。
// Three.js の読み込みに失敗した場合は window.EXTRA_3D_ERROR にメッセージを入れます。
let THREE = null;
let OrbitControls = null;

try {
    THREE = await import('three');
    ({ OrbitControls } = await import('three/addons/controls/OrbitControls.js'));
} catch (error) {
    window.EXTRA_3D_ERROR = 'Three.js を読み込めませんでした。three/ フォルダを確認し、ローカルサーバー経由で開いてください（file:// では読み込めません）。';
    console.error(error);
}

if (THREE && OrbitControls) {
    const SIZE = 9;
    const CUBE_SIZE = 0.9;
    const SPACING = 0.94;
    const OFFSET = ((SIZE - 1) * SPACING) / 2;
    const AXIS_MARGIN = 12;

    const X_AXIS_COLOR = 0xff4d4d;
    const Y_AXIS_COLOR = 0x4dff4d;
    const Z_AXIS_COLOR = 0x4d94ff;

    function cellIndex(x, y, z) {
        return (x * SIZE + y) * SIZE + z;
    }
    function cellPosition(x, y, z) {
        return new THREE.Vector3(x * SPACING - OFFSET, y * SPACING - OFFSET, z * SPACING - OFFSET);
    }
    function makeCellMaterial(color, opacity, emissive) {
        return new THREE.MeshStandardMaterial({
            color,
            transparent: true,
            opacity,
            roughness: 0.35,
            emissive: emissive || 0x000000,
            emissiveIntensity: emissive ? 0.6 : 0,
            depthWrite: false
        });
    }

    let container = null;
    let renderer = null;
    let camera = null;
    let controls = null;
    let scene = null;
    let axisScene = null;
    let axisCamera = null;
    let axisGroup = null;
    let cursorBox = null;
    let frameHandle = 0;
    let axisSize = 140;
    let selectHandler = null;
    let cursorHandler = null;
    let interactive = false;
    let cursor = { x: 4, y: 4, z: 4 };

    const cellMeshes = [];
    const pieceMeshes = new Map();
    const cellMaterials = {};
    const pieceMaterials = {};
    let cellGeometry = null;
    let pieceGeometry = null;

    function buildMaterials() {
        cellMaterials.base = makeCellMaterial(0xffffff, 0.045);
        cellMaterials.blocked = makeCellMaterial(0x111827, 0.55);
        cellMaterials.guide = makeCellMaterial(0x22c55e, 0.3, 0x22c55e);
        cellMaterials.secondGuide = makeCellMaterial(0xf59e0b, 0.36, 0xf59e0b);
        cellMaterials.selected = makeCellMaterial(0xff8000, 0.55, 0xff8000);
        cellMaterials.planeFirst = makeCellMaterial(0xdc2626, 0.12);
        cellMaterials.planeSecond = makeCellMaterial(0x2563eb, 0.12);
        cellMaterials.cubeFirst = makeCellMaterial(0xdc2626, 0.26);
        cellMaterials.cubeSecond = makeCellMaterial(0x2563eb, 0.26);
        pieceMaterials[1] = new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.4, metalness: 0.05 });
        pieceMaterials[-1] = new THREE.MeshStandardMaterial({ color: 0x2563eb, roughness: 0.4, metalness: 0.05 });
        pieceMaterials[3] = new THREE.MeshStandardMaterial({ color: 0x9ca3af, roughness: 0.5, metalness: 0.05 });
    }
    function buildAxisNavigator() {
        axisScene = new THREE.Scene();
        const size = 1.2;
        axisCamera = new THREE.OrthographicCamera(-size, size, size, -size, 0.1, 10);
        axisCamera.position.set(0, 0, 5);
        axisCamera.lookAt(0, 0, 0);
        axisGroup = new THREE.Group();

        const armLength = 1;
        const tipRadius = 0.08;
        const coneLength = 0.2;
        const tipGeometry = new THREE.SphereGeometry(tipRadius, 16, 16);
        const coneGeometry = new THREE.ConeGeometry(tipRadius, coneLength, 16);
        const colliderGeometry = new THREE.SphereGeometry(0.3, 8, 8);
        const colliderMaterial = new THREE.MeshBasicMaterial({ visible: false });

        const createAxis = (direction, color, axisName) => {
            const material = new THREE.MeshBasicMaterial({ color });
            const points = [direction.clone().multiplyScalar(-armLength), direction.clone().multiplyScalar(armLength - coneLength)];
            axisGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color })));

            const cone = new THREE.Mesh(coneGeometry, material);
            cone.position.copy(direction.clone().multiplyScalar(armLength - coneLength / 2));
            cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
            cone.userData = { axis: axisName, dir: 1 };
            const coneCollider = new THREE.Mesh(colliderGeometry, colliderMaterial);
            coneCollider.userData = cone.userData;
            cone.add(coneCollider);
            axisGroup.add(cone);

            const tip = new THREE.Mesh(tipGeometry, material);
            tip.position.copy(direction.clone().multiplyScalar(-armLength));
            tip.userData = { axis: axisName, dir: -1 };
            const tipCollider = new THREE.Mesh(colliderGeometry, colliderMaterial);
            tipCollider.userData = tip.userData;
            tip.add(tipCollider);
            axisGroup.add(tip);
        };
        createAxis(new THREE.Vector3(1, 0, 0), X_AXIS_COLOR, 'x');
        createAxis(new THREE.Vector3(0, 1, 0), Y_AXIS_COLOR, 'y');
        createAxis(new THREE.Vector3(0, 0, 1), Z_AXIS_COLOR, 'z');

        const originDot = new THREE.Mesh(tipGeometry, new THREE.MeshBasicMaterial({ color: 0xffffff }));
        originDot.userData = { action: 'confirm' };
        const originCollider = new THREE.Mesh(colliderGeometry, colliderMaterial);
        originCollider.userData = originDot.userData;
        originDot.add(originCollider);
        axisGroup.add(originDot);
        axisScene.add(axisGroup);
    }
    function buildScene() {
        scene = new THREE.Scene();
        scene.background = new THREE.Color(0x0d0e12);
        scene.add(new THREE.AmbientLight(0xffffff, 0.85));
        const light = new THREE.DirectionalLight(0xffffff, 1.15);
        light.position.set(20, 30, 20);
        scene.add(light);

        cellGeometry = new THREE.BoxGeometry(CUBE_SIZE, CUBE_SIZE, CUBE_SIZE);
        pieceGeometry = new THREE.SphereGeometry(CUBE_SIZE * 0.36, 18, 14);
        for (let x = 0; x < SIZE; x += 1)
            for (let y = 0; y < SIZE; y += 1)
                for (let z = 0; z < SIZE; z += 1) {
                    const mesh = new THREE.Mesh(cellGeometry, cellMaterials.base);
                    mesh.position.copy(cellPosition(x, y, z));
                    mesh.userData = { cell: cellIndex(x, y, z), x, y, z };
                    scene.add(mesh);
                    cellMeshes[cellIndex(x, y, z)] = mesh;
                }

        const cursorGeometry = new THREE.BoxGeometry(CUBE_SIZE * 1.08, CUBE_SIZE * 1.08, CUBE_SIZE * 1.08);
        cursorBox = new THREE.LineSegments(new THREE.EdgesGeometry(cursorGeometry), new THREE.LineBasicMaterial({ color: 0xffff00 }));
        scene.add(cursorBox);
        moveCursorTo(cursor.x, cursor.y, cursor.z);
    }
    function moveCursorTo(x, y, z) {
        cursor = {
            x: Math.max(0, Math.min(SIZE - 1, x)),
            y: Math.max(0, Math.min(SIZE - 1, y)),
            z: Math.max(0, Math.min(SIZE - 1, z))
        };
        cursorBox.position.copy(cellPosition(cursor.x, cursor.y, cursor.z));
        if (typeof cursorHandler === 'function') cursorHandler({ ...cursor });
    }
    function emitSelect() {
        if (!interactive || typeof selectHandler !== 'function') return;
        selectHandler(cellIndex(cursor.x, cursor.y, cursor.z), { ...cursor });
    }
    function handlePointer(event, startPoint) {
        const dx = event.clientX - startPoint.x;
        const dy = event.clientY - startPoint.y;
        if (Math.sqrt(dx * dx + dy * dy) >= 6) return;
        const rect = renderer.domElement.getBoundingClientRect();
        const localX = event.clientX - rect.left;
        const localY = event.clientY - rect.top;
        const fromBottom = rect.height - localY;
        if (localX >= AXIS_MARGIN && localX <= AXIS_MARGIN + axisSize && fromBottom >= AXIS_MARGIN && fromBottom <= AXIS_MARGIN + axisSize) {
            const pointer = new THREE.Vector2(
                ((localX - AXIS_MARGIN) / axisSize) * 2 - 1,
                ((fromBottom - AXIS_MARGIN) / axisSize) * 2 - 1
            );
            const raycaster = new THREE.Raycaster();
            raycaster.setFromCamera(pointer, axisCamera);
            const hit = raycaster.intersectObjects(axisGroup.children, true)
                .find(entry => entry.object.userData.action || entry.object.userData.axis);
            if (!hit) return;
            const data = hit.object.userData;
            if (data.action === 'confirm') {
                emitSelect();
                return;
            }
            moveCursorTo(
                cursor.x + (data.axis === 'x' ? data.dir : 0),
                cursor.y + (data.axis === 'y' ? data.dir : 0),
                cursor.z + (data.axis === 'z' ? data.dir : 0)
            );
            return;
        }
        const pointer = new THREE.Vector2((localX / rect.width) * 2 - 1, -(localY / rect.height) * 2 + 1);
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(pointer, camera);
        const intersects = raycaster.intersectObjects(cellMeshes, false);
        if (intersects.length === 0) return;
        const data = intersects[0].object.userData;
        moveCursorTo(data.x, data.y, data.z);
        emitSelect();
    }
    function computeAxisSize(rect) {
        return Math.round(Math.min(150, Math.max(88, Math.min(rect.width, rect.height) * 0.32)));
    }
    function renderFrame() {
        frameHandle = requestAnimationFrame(renderFrame);
        controls.update();
        const width = renderer.domElement.clientWidth;
        const height = renderer.domElement.clientHeight;
        renderer.setViewport(0, 0, width, height);
        renderer.setScissorTest(false);
        renderer.render(scene, camera);
        renderer.setViewport(AXIS_MARGIN, AXIS_MARGIN, axisSize, axisSize);
        renderer.setScissor(AXIS_MARGIN, AXIS_MARGIN, axisSize, axisSize);
        renderer.setScissorTest(true);
        axisGroup.quaternion.copy(camera.quaternion).invert();
        renderer.render(axisScene, axisCamera);
    }

    const view = {
        ready: true,
        get cursor() {
            return { ...cursor };
        },
        init(targetContainer) {
            if (renderer) {
                this.attach(targetContainer);
                return;
            }
            container = targetContainer;
            buildMaterials();
            buildAxisNavigator();
            buildScene();
            renderer = new THREE.WebGLRenderer({ antialias: true });
            renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
            renderer.domElement.style.display = 'block';
            renderer.domElement.style.width = '100%';
            renderer.domElement.style.height = '100%';
            renderer.domElement.style.touchAction = 'none';
            container.appendChild(renderer.domElement);
            camera = new THREE.PerspectiveCamera(55, 1, 0.1, 1000);
            camera.position.set(14, 14, 18);
            controls = new OrbitControls(camera, renderer.domElement);
            controls.enableDamping = true;
            controls.dampingFactor = 0.05;
            controls.enablePan = false;

            let startPoint = { x: 0, y: 0 };
            renderer.domElement.addEventListener('pointerdown', event => {
                startPoint = { x: event.clientX, y: event.clientY };
            });
            renderer.domElement.addEventListener('pointerup', event => handlePointer(event, startPoint));
            this.resize();
            renderFrame();
        },
        attach(targetContainer) {
            if (!renderer || !targetContainer) return;
            container = targetContainer;
            if (renderer.domElement.parentElement !== container) container.appendChild(renderer.domElement);
            this.resize();
        },
        resize() {
            if (!renderer || !container) return;
            const rect = container.getBoundingClientRect();
            const width = Math.max(1, Math.floor(rect.width));
            const height = Math.max(1, Math.floor(rect.height));
            renderer.setSize(width, height, false);
            camera.aspect = width / height;
            camera.updateProjectionMatrix();
            axisSize = computeAxisSize(rect);
        },
        setOnSelect(handler) {
            selectHandler = handler;
        },
        setOnCursorChange(handler) {
            cursorHandler = handler;
            if (typeof handler === 'function') handler({ ...cursor });
        },
        setState(state) {
            if (!renderer) return;
            const board = state.board;
            const guides = state.guides || new Set();
            const secondGuides = state.secondGuides || new Set();
            const selected = new Set(state.selected || []);
            const territories = state.territories;
            interactive = Boolean(state.interactive);
            for (let cell = 0; cell < cellMeshes.length; cell += 1) {
                const mesh = cellMeshes[cell];
                const value = board[cell];
                let material = cellMaterials.base;
                if (value === 2) material = cellMaterials.blocked;
                if (territories) {
                    if (territories.cellsForFirst.has(cell)) material = cellMaterials.planeFirst;
                    if (territories.cellsForSecond.has(cell)) material = cellMaterials.planeSecond;
                }
                if (secondGuides.has(cell)) material = cellMaterials.secondGuide;
                else if (guides.has(cell)) material = cellMaterials.guide;
                if (selected.has(cell)) material = cellMaterials.selected;
                mesh.material = material;

                const existing = pieceMeshes.get(cell);
                if (value === 1 || value === -1 || value === 3) {
                    if (existing) {
                        existing.material = pieceMaterials[value];
                    } else {
                        const piece = new THREE.Mesh(pieceGeometry, pieceMaterials[value]);
                        piece.position.copy(mesh.position);
                        scene.add(piece);
                        pieceMeshes.set(cell, piece);
                    }
                } else if (existing) {
                    scene.remove(existing);
                    pieceMeshes.delete(cell);
                }
            }
            if (territories) {
                const strong = (regions, material) => {
                    for (const region of regions)
                        for (const cell of region.cells) {
                            if (selected.has(cell) || guides.has(cell) || secondGuides.has(cell)) continue;
                            if (board[cell] === 2) continue;
                            cellMeshes[cell].material = material;
                        }
                };
                strong(territories.firstCubes, cellMaterials.cubeFirst);
                strong(territories.secondCubes, cellMaterials.cubeSecond);
            }
        },
        focusCell(cell) {
            if (!renderer || typeof cell !== 'number') return;
            const x = Math.floor(cell / (SIZE * SIZE));
            const y = Math.floor(cell / SIZE) % SIZE;
            moveCursorTo(x, y, cell % SIZE);
        },
        stop() {
            if (frameHandle) cancelAnimationFrame(frameHandle);
            frameHandle = 0;
        },
        start() {
            if (!renderer || frameHandle) return;
            renderFrame();
        }
    };

    window.Extra3DView = view;
    window.dispatchEvent(new Event('extra3d-ready'));
} else {
    window.dispatchEvent(new Event('extra3d-ready'));
}
