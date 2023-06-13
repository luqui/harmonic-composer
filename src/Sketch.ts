import p5 from "p5";
import { Viewport, LinearViewport, LogViewport } from "./Viewport";
import { QuantizationGrid } from "./QuantizationGrid";
import { NotesView, Player } from "./NotesView";
import { ExactNumber as N } from "exactnumber";

const sketch = (p: p5) => {
  let viewport: Viewport;
  let grid: QuantizationGrid;
  let notesView: NotesView;
  let player: Player;

  p.setup = () => {
    p.createCanvas(p.windowWidth, p.windowHeight);
    // viewport = new LinearViewport(0, 32, 40, 1600);
    viewport = new LogViewport(0, 36, 40, 108);
    grid = new QuantizationGrid(1, N("216"));
    notesView = new NotesView(grid);
    player = null;

    p.frameRate(24);
  };

  p.windowResized = () => {
    p.resizeCanvas(p.windowWidth, p.windowHeight);
  };


  p.mousePressed = () => {
    notesView.handleMousePressed(p, viewport);
  };

  p.mouseReleased = () => {
    notesView.handleMouseReleased(p, viewport);
  };

  p.keyPressed = () => {
    notesView.handleKeyPressed(p);

    switch (p.keyCode) {
        case 32: { // space
            if (player) {
                player.stop();
                player = null;
            }
            else {
                player = notesView.play(p, viewport);
                console.log("Playing", player);
            }
            break;
        }
        case 37: { // <-
            viewport.translateX(-0.25);
            break;
        }
        case 39: { // ->
            viewport.translateX(0.25);
            break;
        }
        case 38: { // ^
            viewport.translateY(0.25);
            break;
        }
        case 40: { // v
            viewport.translateY(-0.25);
            break;
        }
        case 86: { // 'v'
            const xmin = viewport.mapXinv(0, p);
            const xmax = viewport.mapXinv(p.width, p);
            const ymin = viewport.mapYinv(p.height, p);
            const ymax = viewport.mapYinv(0, p);
            if (viewport instanceof LogViewport) {
                viewport = new LinearViewport(xmin, ymin, xmax, ymax);
            }
            else {
                const noteMin = ymin < 0 ? 1 : 12 * Math.log2(ymin / 440) + 69;
                const noteMax = ymax < 0 ? 1 : 12 * Math.log2(ymax / 440) + 69;
                viewport = new LogViewport(xmin, noteMin, xmax, noteMax); 
            }
        }
    }
  };

  p.keyReleased = () => {
    notesView.handleKeyReleased(p);
  };

  p.draw = () => {
    p.background(255);
    grid.drawGrid(p, viewport);
    notesView.draw(p, viewport);

    if (player) {
        player.step(p);
    }
  };
};

const container = document.getElementById('sketch-container');
const myP5 = new p5(sketch, container);

export default myP5;

