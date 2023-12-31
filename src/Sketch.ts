import p5 from "p5";
import { initializeMidiAccess, MPEInstrument, ToneSynth } from './Instrument';
import { Viewport } from "./Viewport";
import { NotesView, Player } from "./NotesView";
import { ExactNumberType, ExactNumber as N } from "exactnumber";

async function createMidiOutputSelect(
  onMidi: (output: WebMidi.MIDIOutput, description: HTMLElement) => void,
  onWebSynth: (description: HTMLElement) => void
) {
  const outputs = await initializeMidiAccess();
  const container = document.querySelector<HTMLDivElement>("#output-select-container");

  if (!container) {
    console.error("Output select container not found");
    return;
  }

  const select = document.createElement("select");
  container.appendChild(select);

  const description = document.createElement("span");
  description.style.marginLeft = "1em";
  container.appendChild(description);

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

    description.innerHTML = "";
    if (outputName === "web_synth") {
      onWebSynth(description);
    } else {
      const midiOutput = outputs.get(outputName);
      if (midiOutput) {
        onMidi(midiOutput, description);
      }
    }
  });

  if (select.value == 'web_synth') {
      onWebSynth(description);
  }
  else {
      select.value = "web_synth";
  }
}

const sketch = (p: p5) => {
  let notesView: NotesView;
  let player: Player;

  p.setup = () => {
    const canvas = p.createCanvas(p.windowWidth - 50, p.windowHeight - 100);
    notesView = new NotesView(p);
    player = null;

    canvas.mousePressed(() => notesView.handleMousePressed());
    canvas.mouseReleased(() => notesView.handleMouseReleased());

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
        (output: WebMidi.MIDIOutput, description: HTMLElement) => {
            const container = document.getElementById('synth-params-container');
            container.style.display = 'none';

            description.innerHTML = "<i>- 15 voice MPE<i>";

            notesView.setInstrument(new MPEInstrument(output, 12));
        },
        (description: HTMLElement) => {
            const toneSynth = new ToneSynth();
            const container = document.getElementById('synth-params-container');
            container.innerHTML = '';
            container.appendChild(toneSynth.getParamsHTML());
            container.style.display = 'none';
            notesView.setInstrument(toneSynth);

            description.innerHTML = '';
            const button = document.createElement('input');
            button.setAttribute('type', 'button');
            button.setAttribute('value', 'Synth Params');
            button.addEventListener('click', () => {
                if (container.style.display === 'none') {
                    container.style.display = 'block';
                }
                else {
                    container.style.display = 'none';
                }
            });
            description.appendChild(button);
        });

  };

  p.windowResized = () => {
    p.resizeCanvas(p.windowWidth - 50, p.windowHeight - 100);
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

