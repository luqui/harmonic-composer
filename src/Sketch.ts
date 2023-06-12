import p5 from "p5";
import { Viewport } from "./Viewport";

const sketch = (p: p5) => {
  let viewport: Viewport;

  p.setup = () => {
    p.createCanvas(p.windowWidth, p.windowHeight);
    viewport = new Viewport(0, 32, 40, 1600);
  };

  p.windowResized = () => {
    p.resizeCanvas(p.windowWidth, p.windowHeight);
  };

  p.draw = () => {
    p.background(255);
    drawGrid(p);
  };

  function drawGrid(p: p5) {
    p.stroke(200);
    p.strokeWeight(1);

    const x0 = viewport.mapXinv(0, p);
    const xf = viewport.mapXinv(p.width, p);
    for (let x = x0; x < xf; x += 1) {
      p.line(viewport.mapX(x, p), 0, viewport.mapX(x, p), p.height);
    }

    const y0 = viewport.mapYinv(p.height, p);
    const yf = viewport.mapYinv(0, p);
    for (let y = y0; y < yf; y += 40) {
      p.line(0, viewport.mapY(y, p), p.width, viewport.mapY(y, p));
    }
  }
};

const myP5 = new p5(sketch, document.getElementById('sketch-container'));
export default myP5;
