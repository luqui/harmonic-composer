import p5 from "p5";
import { Viewport } from "./Viewport";
import { QuantizationGrid } from "./QuantizationGrid";
import { NotesView, Player } from "./NotesView";

const sketch = (p: p5) => {
  let viewport: Viewport;
  let grid: QuantizationGrid;
  let notesView: NotesView;
  let player: Player;

  p.setup = () => {
    p.createCanvas(p.windowWidth, p.windowHeight);
    viewport = new Viewport(0, 32, 40, 1600);
    grid = new QuantizationGrid(1, 40);
    notesView = new NotesView(grid);
    player = null;
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

    if (p.keyCode === 32) {
        if (player) {
            player.stop();
            player = null;
        }
        else {
            player = notesView.play(p);
            console.log("Playing", player);
        }
    }
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

const myP5 = new p5(sketch, document.getElementById('sketch-container'));

export default myP5;
