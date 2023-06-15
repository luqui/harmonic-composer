import p5 from "p5";
import { initializeMidiAccess, MPEInstrument, ToneSynth } from './Instrument';
import { Viewport, LinearViewport, LogViewport } from "./Viewport";
import { QuantizationGrid } from "./QuantizationGrid";
import { NotesView, Player } from "./NotesView";
import { ExactNumberType, ExactNumber as N } from "exactnumber";

async function createMidiOutputSelect(
  onMidi: (output: WebMidi.MIDIOutput) => void,
  onWebSynth: () => void
) {
  const outputs = await initializeMidiAccess();
  const container = document.querySelector<HTMLDivElement>("#output-select-container");

  if (!container) {
    console.error("Output select container not found");
    return;
  }

  const select = document.createElement("select");
  container.appendChild(select);

  const webSynthOption = document.createElement("option");
  webSynthOption.value = "web_synth";
  webSynthOption.textContent = "Web Synth";
  select.appendChild(webSynthOption);

  outputs.forEach((output: WebMidi.MIDIOutput, outputKey: string) => {
    const option = document.createElement("option");
    option.value = outputKey;
    option.textContent = output.name;
    select.appendChild(option);
  });

  select.addEventListener("change", (e) => {
    const target = e.target as HTMLSelectElement;
    const outputName = target.value;

    if (outputName === "web_synth") {
      onWebSynth();
    } else {
      const midiOutput = outputs.get(outputName);
      if (midiOutput) {
        onMidi(midiOutput);
      }
    }
  });
}

const sketch = (p: p5) => {
  let viewport: Viewport;
  let grid: QuantizationGrid;
  let notesView: NotesView;
  let player: Player;

  p.setup = () => {
    p.createCanvas(p.windowWidth - 50, p.windowHeight - 100);
    viewport = new LogViewport(0, 36, 40, 108);
    grid = new QuantizationGrid(1, N("216"));
    notesView = new NotesView(grid);
    player = null;

    p.frameRate(24);

    const loadHash = () => {
        try {
            const jsonStr = Buffer.from(document.location.hash, "base64").toString()
            const json = JSON.parse(jsonStr);
            notesView.deserialize(json);
        }
        catch (e) {
            console.log("Loading failed", e);
        }
    };

    loadHash();
    window.addEventListener('hashchange', (e:Event) => {
        loadHash();
    });
    
    createMidiOutputSelect(
        (output: WebMidi.MIDIOutput) => {
            notesView.setInstrument(new MPEInstrument(output, 12));
        },
        () => {
            notesView.setInstrument(new ToneSynth());
        });

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
    notesView.handleKeyPressed(p, viewport);

    const subdivKey = (subdiv: ExactNumberType) => {
        if (p.keyIsDown(p.CONTROL)) {
            if (p.keyIsDown(p.SHIFT)) {
                grid.setXSnap(grid.getXSnap() * subdiv.toNumber());
            }
            else {
                grid.setXSnap(grid.getXSnap() / subdiv.toNumber());
            }
        }
        else {
            if (p.keyIsDown(p.SHIFT)) {
                grid.setYSnap(grid.getYSnap().mul(subdiv));
            }
            else {
                grid.setYSnap(grid.getYSnap().div(subdiv));
            }
        }
    };

    switch (p.keyCode) {
        case 32: { // space
            if (player) {
                player.stop();
                player = null;
            }
            else {
                player = notesView.play(p, viewport);
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
            break;
        }
        case 50: { // 2
            subdivKey(N('2'));
            break;
        }
        case 51: { // 3
            subdivKey(N('3'));
            break;
        }
        case 83: {// s -- save
            if (p.keyIsDown(p.CONTROL)) {
                document.location.hash = Buffer.from(JSON.stringify(notesView.serialize())).toString("base64");
            }
        }
    }
  };

  p.draw = () => {
    p.background(255);
    grid.drawGrid(p, viewport);
    notesView.draw(p, viewport);

    if (player) {
        p.colorMode(p.RGB);
        p.strokeWeight(2);
        p.stroke(0, 128, 0);
        p.line(viewport.mapX(player.getPlayhead(p), p), 0, viewport.mapX(player.getPlayhead(p), p), p.height);

    }
  };
};

const container = document.getElementById('sketch-container');
const myP5 = new p5(sketch, container);

export default myP5;

