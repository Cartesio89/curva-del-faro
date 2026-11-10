import * as THREE from "three";
import { buildCar, disposeCar } from "./carmodel.js";

// Garage turntable: one car on a lit platform, drag to rotate.
export class Showroom {
  constructor(renderer, canvas) {
    this.renderer = renderer;
    const scene = (this.scene = new THREE.Scene());
    scene.background = new THREE.Color("#1d1c25");
    scene.fog = new THREE.Fog("#1d1c25", 14, 30);
    this.camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
    scene.add(new THREE.HemisphereLight("#fff1dc", "#2a2833", 1.3));
    const key = new THREE.DirectionalLight("#fff4e2", 2.6);
    key.position.set(4, 7, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    Object.assign(key.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 1, far: 20 });
    scene.add(key);
    const rim = new THREE.DirectionalLight("#7fd3ff", 1.4);
    rim.position.set(-5, 3, -6);
    scene.add(rim);
    const floorTex = (() => {
      const c = document.createElement("canvas"); c.width = c.height = 512;
      const g = c.getContext("2d");
      const grd = g.createRadialGradient(256, 256, 20, 256, 256, 256);
      grd.addColorStop(0, "#4a4656"); grd.addColorStop(0.7, "#2a2833"); grd.addColorStop(1, "#1d1c25");
      g.fillStyle = grd; g.fillRect(0, 0, 512, 512);
      g.strokeStyle = "rgba(255,178,62,0.5)"; g.lineWidth = 4; g.beginPath(); g.arc(256, 256, 200, 0, Math.PI * 2); g.stroke();
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
    })();
    const floor = new THREE.Mesh(new THREE.CircleGeometry(6, 48), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.6, metalness: 0.2 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);
    this.turn = new THREE.Group();
    scene.add(this.turn);
    this.angle = 0.7;
    this.spin = 0.25;
    this.dark = new THREE.MeshBasicMaterial({ color: "#0d0c12" });

    let dragging = false, lastX = 0;
    canvas.addEventListener("pointerdown", (e) => { if (!this.active) return; dragging = true; lastX = e.clientX; this.spin = 0; });
    addEventListener("pointermove", (e) => { if (!dragging) return; this.angle += (e.clientX - lastX) * 0.01; lastX = e.clientX; });
    addEventListener("pointerup", () => { if (dragging) { dragging = false; this.spin = 0.25; } });
  }
  setCar(car, cfg, locked) {
    if (this.model) { this.turn.remove(this.model); disposeCar(this.model); }
    this.model = buildCar(car, cfg);
    this.model.traverse((m) => { if (m.isMesh) { m.castShadow = true; if (locked) m.material = this.dark; } });
    this.turn.add(this.model);
    const L = car.shape.L;
    this.camDist = 4.2 + L * 1.25;
  }
  setAspect(w, h) {
    this.camera.aspect = w / h;
    this.portrait = h > w || w < 760;
    this.camera.fov = this.portrait ? 46 : 32;
    // keep the car clear of the menu panel: right-hand panel on wide screens, bottom sheet on phones
    if (this.portrait) this.camera.setViewOffset(w, h, 0, h * 0.3, w, h);
    else this.camera.setViewOffset(w, h, Math.min(w * 0.2, 220), 0, w, h);
    this.camera.updateProjectionMatrix();
  }
  render(dt) {
    this.angle += this.spin * dt;
    this.turn.rotation.y = this.angle;
    const d = (this.camDist || 7) * (this.portrait ? 1.3 : 1);
    this.camera.position.set(0, this.portrait ? 2.4 : 1.9, d);
    this.camera.lookAt(0, this.portrait ? 0.2 : 0.55, 0);
    this.renderer.render(this.scene, this.camera);
  }
}
