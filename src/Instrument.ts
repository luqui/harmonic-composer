import { default as p5mod } from "p5";
import * as Tone from "tone";

declare var p5: p5mod;

const CLEANUP_LATENCY : number = 0.250;

export interface PlayingNote {
    stop(when: number): void;
}

export interface Instrument {
    // Start playing a note at the given frequency and velocity (0-1)
    startNote(when: number, freq: number, velocity: number): PlayingNote;

    // Play a note at a given frequency and duration.
    playNote(when: number, duration: number, freq: number, velocity: number): void;

    stopAllNotes(when: number): void;
}

type Time = number;

Tone.Transport.start();

class AmplitudeControl {
    private osc: Tone.Oscillator;
    private env: Tone.Envelope;
    
    constructor(osc: Tone.Oscillator, envelope: Tone.Envelope)
    {
        this.osc = osc;
        this.env = envelope;

        osc.connect(this.env);
    }

    triggerAttack(when: Time): void {
        this.env.triggerAttack(when);
    }

    triggerRelease(when: Time): void {
        this.env.triggerRelease(when);
        setTimeout(() => {
            this.osc.dispose();
            this.env.dispose();
        }, 1000 * (when - Tone.now() + Tone.Time(this.env.release).toSeconds() + CLEANUP_LATENCY));
    }
}

class Iso<T, U> {
    public to : (x: T) => U;
    public from : (x: U) => T;
    constructor(to: (x: T) => U, from: (x: U) => T) {
        this.to = to;
        this.from = from;
    }

    static linearScale(min: number, max: number): Iso<number, number> {
        return new Iso((x: number) => min + x * (max - min), 
                       (y: number) => (y - min) / (max - min));
    }

    static powerScale(power: number): Iso<number, number> {
        return new Iso((x: number) => Math.pow(x, power), (y: number) => Math.pow(y, 1/power));
    }

    static positiveScale(): Iso<number, number> {
        return new Iso((x: number) => 1 / (1 - x) - 1, (y: number) => 1 - 1 / (y + 1));
    }

    compose<V>(i: Iso<U,V>): Iso<T, V> {
        return new Iso((x: T) => i.to(this.to(x)), (y:V) => this.from(i.from(y)));
    }
}

class TonePlayingNote implements PlayingNote {
    private osc: AmplitudeControl;
    private oscs: Set<TonePlayingNote>;
    constructor(osc: AmplitudeControl, oscs: Set<TonePlayingNote>) {
        this.osc = osc;
        this.oscs = oscs;

        this.oscs.add(this);
    }

    stop(when: number): void {
        this.osc.triggerRelease(when);
        this.oscs.delete(this);
    }
}

function cloneSet<T>(s : Set<T>): Set<T> {
    let r: Set<T> = new Set();
    for (const x of s) {
        r.add(x);
    }
    return r;
}

export class ToneSynth implements Instrument {
    private oscs: Set<TonePlayingNote>;

    private attack: number;
    private decay: number;
    private sustain: number;
    private release: number;
    private type: string;

    constructor() {
        this.oscs = new Set();
        this.attack = 0.05;
        this.decay = 1;
        this.sustain = 0.25;
        this.release = 1;
        this.type = "triangle";
    }

    startNote(when: number, freq: number, velocity: number): PlayingNote {
        const env = new Tone.AmplitudeEnvelope(this.attack, this.decay, this.sustain, this.release).toDestination();
        const osc = new Tone.Oscillator(freq, this.type as Tone.ToneOscillatorType).start();
        osc.volume.value = 10 * Math.log2(velocity) - 10;
        const amp = new AmplitudeControl(osc, env);
        amp.triggerAttack(when);

        return new TonePlayingNote(amp, this.oscs);

    }

    playNote(when: number, duration: number, freq: number, velocity: number): void {
        const osc = this.startNote(when, freq, velocity);
        osc.stop(when + duration);
    }

    stopAllNotes(when: number): void {
        const oscs = cloneSet(this.oscs);
        for (const osc of oscs) {
            osc.stop(when);
        }
    }

    private makeTable(elements: HTMLElement[][]) {
        const tableEl = document.createElement('table');
        for (const row of elements) {
            const tr = document.createElement('tr');
            tableEl.appendChild(tr);

            for (const col of row) {
                const td = document.createElement('td');
                tr.appendChild(td);

                td.appendChild(col);
            }
        }
        return tableEl;
    }

    private makeFader(label: string, value: number, scale: Iso<number, number>, onChange: (v: number) => void) {
        const spanEl = document.createElement('span');
        spanEl.setAttribute('class', 'fader');

        const labelEl = document.createElement('label');
        labelEl.innerText = label;

        const inputEl = document.createElement('input');
        inputEl.setAttribute('type', 'range');
        inputEl.setAttribute('orient', 'vertical');
        inputEl.setAttribute('min', '0');
        inputEl.setAttribute('max', '1');
        inputEl.setAttribute('step', 'any');
        inputEl.value = String(scale.from(value));

        const valueEl = document.createElement('span');
        valueEl.innerText = value.toFixed(2);

        inputEl.addEventListener('input', (e) => {
            const scaledVal = scale.to(Number(inputEl.value));
            valueEl.innerText = scaledVal.toFixed(2);
            onChange(scaledVal);
        });

        spanEl.appendChild(this.makeTable([[labelEl], [inputEl], [valueEl]]));
        return spanEl;
    }
    getParamsHTML() {
        const div = document.createElement('div');

        const typeDiv = document.createElement('div');
        div.appendChild(typeDiv);
        const typeEl = document.createElement('select');
        typeDiv.innerText = "Type: ";
        typeDiv.appendChild(typeEl);

        for (const type of ["sine", "square", "triangle", "sawtooth"]) {
            const option = document.createElement('option');
            option.setAttribute('value', type);
            option.innerText = type;
            typeEl.appendChild(option);
        }
        typeEl.value = this.type;
        typeEl.addEventListener('change', () => { this.type = typeEl.value; });


        div.appendChild(
            this.makeFader('A', this.attack,
                           Iso.powerScale(3).compose(Iso.linearScale(0, 5)), (v: number) => { this.attack = v }))
        div.appendChild(
            this.makeFader('D', this.decay,
                           Iso.powerScale(3).compose(Iso.linearScale(0, 20)), (v: number) => { this.decay = v }));
        div.appendChild(
            this.makeFader('S', this.sustain,
                           Iso.linearScale(0, 1), (v: number) => { this.sustain = v }));
        div.appendChild(
            this.makeFader('R', this.release,
                           Iso.powerScale(3).compose(Iso.linearScale(0, 5)), (v: number) => { this.release = v }));

        return div;
    }
}

export async function initializeMidiAccess(): Promise<ReadonlyMap<string, WebMidi.MIDIOutput>> {
    if (!navigator.requestMIDIAccess) {
      console.warn("Web MIDI API not supported in this browser");
      return;
    }

    const midiAccess = await navigator.requestMIDIAccess();
    if (midiAccess.outputs.size === 0) {
      console.warn("No MIDI output devices found");
      return;
    }

    return midiAccess.outputs;
}


interface MPEInstrumentProxy {
    midiOutput: WebMidi.MIDIOutput;
    playingNotes: Set<MPEPlayingNote>;
    availableChannels: number[];
    toMidiTime(seconds: number): number;
}

class MPEPlayingNote implements PlayingNote {
    private channel: number;
    private note: number;
    private instrument: MPEInstrumentProxy;

    constructor(channel: number, note: number, instrument: MPEInstrumentProxy) {
        this.channel = channel;
        this.note = note;
        this.instrument = instrument;
        this.instrument.playingNotes.add(this);
    }

    stop(when: number) {
        const now = window.performance.now()
        const stopTime = this.instrument.toMidiTime(when);
        this.instrument.midiOutput.send([0x90 + this.channel, this.note, 0], stopTime);

        this.instrument.availableChannels.push(this.channel);
        this.instrument.playingNotes.delete(this);
    }
}

const PITCH_BEND_RANGE = 2;

export class MPEInstrument implements MPEInstrumentProxy {
  midiOutput: WebMidi.MIDIOutput;
  availableChannels: number[];
  numChannels: number;
  playingNotes: Set<MPEPlayingNote>

  constructor(midiOutput: WebMidi.MIDIOutput, numChannels: number) {
    this.midiOutput = midiOutput;
    this.numChannels = numChannels;
    this.availableChannels = Array.from({ length: numChannels }, (_, i) => i+1);
    this.playingNotes = new Set();

    this.setupMPE();
  }

  private setupMPE() {
    if (!this.midiOutput) {
      return;
    }

    // Turn off omni mode.
    this.midiOutput.send([0xB0, 0x7D, 0x00]);

    const minChannel = 2;
    const maxChannel = minChannel + this.numChannels - 1;
    this.midiOutput.send([0xB0, 0x65, 0x00]); // RPN LSB (Set RPN address 0x0002)
    this.midiOutput.send([0xB0, 0x64, 0x02]); // RPN MSB (Set RPN address 0x0002)
    this.midiOutput.send([0xB0, 0x06, maxChannel]); // Data Entry MSB (Assign max channel to lower zone)

    for (let channel = 0; channel < this.numChannels; channel++) {
      this.midiOutput.send([0xB0 + channel, 100, 0]);
      this.midiOutput.send([0xB0 + channel, 101, 0]);
      this.midiOutput.send([0xB0 + channel, 6, PITCH_BEND_RANGE]);
      this.midiOutput.send([0xB0 + channel, 38, 0]);  // pitch bend range LSB
    }
  }

  startNote(when: number, freq: number, velocity: number): MPEPlayingNote {
    if (!this.midiOutput)
        return;

    if (this.availableChannels.length === 0) {
      console.log("Dropped note, too many playing notes");
      return;
    }

    const whenM = this.toMidiTime(when);

    const channel = this.availableChannels.splice(0, 1)[0];

    const [note, pitchBend] = this.frequencyToMidiAndPitchBend(freq);
    this.midiOutput.send([0x90 + channel, note, Math.floor(127*velocity)], whenM);
    this.midiOutput.send([0xE0 + channel, pitchBend & 0x7F, (pitchBend >> 7) & 0x7F], whenM);

    const playingNote = new MPEPlayingNote(channel, note, this);
    return playingNote;
  }

  playNote(when: number, duration: number, freq: number, velocity: number): void {
    const note = this.startNote(when, freq, velocity);
    note.stop(when + duration);
  }

  stopAllNotes(when: number) {
      const playingNotes = cloneSet(this.playingNotes);
      for (const n of playingNotes) {
          n.stop(when);
      }
  }

  toMidiTime(when: number): number {
      return window.performance.now() - 1000*Tone.now() + 1000*when;
  }

  private frequencyToMidiAndPitchBend(freq: number): [number, number] {
    const midiNote = 69 + 12 * Math.log2(freq / 440);
    const nearestMidi = Math.round(midiNote);
    const pitchBend = Math.round((midiNote - nearestMidi) * 8191 / PITCH_BEND_RANGE) + 8192;

    return [nearestMidi, pitchBend];
  }
}
