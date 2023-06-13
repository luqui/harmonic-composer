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
    viewport = new LogViewport(0, 1, 40, 127);
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
        case 32: {
            if (player) {
                player.stop();
                player = null;
            }
            else {
                player = notesView.play(p);
                console.log("Playing", player);
            }
            break;
        }
        case 37: {
            const width = viewport.mapXinv(p.width, p) - viewport.mapXinv(0, p);
            viewport.translateX(-width / 4);
            break;
        }
        case 39: {
            const width = viewport.mapXinv(p.width, p) - viewport.mapXinv(0, p);
            viewport.translateX(width / 4);
            break;
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

