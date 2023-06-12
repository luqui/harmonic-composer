import p5 from "p5";
import { Viewport } from "./Viewport";
import { QuantizationGrid } from "./QuantizationGrid";

const sketch = (p: p5) => {
  let viewport: Viewport;
  let grid: QuantizationGrid;

  p.setup = () => {
    p.createCanvas(p.windowWidth, p.windowHeight);
    viewport = new Viewport(0, 32, 40, 1600);
    grid = new QuantizationGrid(1, 40);
  };

  p.windowResized = () => {
    p.resizeCanvas(p.windowWidth, p.windowHeight);
  };

  p.draw = () => {
    p.background(255);
    grid.drawGrid(p, viewport);
  };
};

const myP5 = new p5(sketch, document.getElementById('sketch-container'));
export default myP5;
