import p5 from "p5";
import { initializeMidiAccess, MPEInstrument, ToneSynth } from './Instrument';
import { Viewport } from "./Viewport";
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
  let notesView: NotesView;
  let player: Player;

  p.setup = () => {
    p.createCanvas(p.windowWidth - 50, p.windowHeight - 100);
    notesView = new NotesView(p);
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
    notesView.handleMousePressed();
  };

  p.mouseReleased = () => {
    notesView.handleMouseReleased();
  };

  p.keyPressed = () => {
    notesView.handleKeyPressed();
      
    switch (p.keyCode) {
        case 32: { // space
            if (player) {
                player.stop();
                player = null;
            }
            else {
                player = notesView.play();
            }
            break;
        }
    }
  };

  p.draw = () => {
    p.background(255);

    notesView.draw();
    if (player) {
        notesView.drawPlayhead(player.getPlayhead());
    }
  };
};

const container = document.getElementById('sketch-container');
const myP5 = new p5(sketch, container);

export default myP5;

