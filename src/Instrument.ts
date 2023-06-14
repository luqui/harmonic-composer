import { default as p5mod } from "p5";
import p5sound from "p5/lib/addons/p5.sound";

declare var p5: p5mod;

const RELEASE_TIME : number = 0.02;

export interface Instrument {
    // Start playing a note at the given frequency and velocity (0-1)
    startNote(freq: number, velocity: number): void;

    // Stop playing the note at the given frequency in `secondsFromNow` seconds.
    stopNote(freq: number, secondsFromNow: number): void;

    // Play a note at a given frequency and duration.
    playNote(freq: number, velocity: number, duration: number): void;
}

export class ToneSynth implements Instrument {
    private oscs: { [freq: number]: { osc: p5mod.Oscillator, env: p5mod.Envelope } };

    constructor() {
        this.oscs = {};
        console.log(p5sound);
    }

    startNote(freq: number, velocity: number): void {
        this.stopNote(freq, 0);

        // Horrible typescript fighting.

        // @ts-ignore
        const osc = new p5.Oscillator(freq, 'triangle');
        // @ts-ignore
        const env = new p5.Envelope();
        env.setADSR(0.05, 2, 0.25, RELEASE_TIME);
        osc.start();
        env.mult(velocity).triggerAttack(osc, 0);
        this.oscs[freq] = { osc: osc, env: env };
    }

    stopNote(freq: number, secondsFromNow: number): void {
        if (this.oscs[freq]) {
            const osc = this.oscs[freq];
            delete this.oscs[freq];

            osc.env.triggerRelease(osc.osc, secondsFromNow);
            setTimeout(() => { osc.osc.stop(0) }, (secondsFromNow + RELEASE_TIME) * 1000 + 60);  // 60 ms for the envelope to fully stop
        }
    }

    playNote(freq: number, velocity: number, duration: number): void {
        this.startNote(freq, velocity);
        this.stopNote(freq, duration);
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

export class MPEInstrument implements Instrument {
  private midiOutput: WebMidi.MIDIOutput;
  private availableChannels: number[];
  private channelMap: Map<number, number>;

  constructor(midiOutput: WebMidi.MIDIOutput, numChannels: number) {
    this.midiOutput = midiOutput;
    this.availableChannels = Array.from({ length: numChannels }, (_, i) => i);
    this.channelMap = new Map<number, number>();

    this.setupPitchBendRange();
  }

  private setupPitchBendRange() {
    if (!this.midiOutput) {
      return;
    }

    const pitchBendRange = [0, 2];  // +- 2 semitones
    const pitchBendRangeMSB = pitchBendRange[1];

    for (let channel = 0; channel < this.availableChannels.length; channel++) {
      this.midiOutput.send([0xB0 + channel, 100, 0]);
      this.midiOutput.send([0xB0 + channel, 101, 0]);
      this.midiOutput.send([0xB0 + channel, 6, pitchBendRangeMSB]);
      this.midiOutput.send([0xB0 + channel, 38, pitchBendRange[0]]);
    }
  }

  startNote(freq: number, velocity: number): void {
    if (!this.midiOutput || this.availableChannels.length === 0) {
      return;
    }

    const channel = this.availableChannels.splice(0, 1)[0];
    this.channelMap.set(freq, channel);

    const [note, pitchBend] = this.frequencyToMidiAndPitchBend(freq);
    this.midiOutput.send([0x90 + channel, note, Math.floor(127*velocity)]);
    this.midiOutput.send([0xE0 + channel, pitchBend & 0x7F, (pitchBend >> 7) & 0x7F]);
  }

  stopNote(freq: number, secondsFromNow: number): void {
    const channel = this.channelMap.get(freq);
    if (!this.midiOutput || channel === undefined) {
      return;
    }

    const [note] = this.frequencyToMidiAndPitchBend(freq);
    this.midiOutput.send(
      [0x90 + channel, note, 0],
      window.performance.now() + secondsFromNow * 1000
    );

    this.availableChannels.push(channel);
    this.channelMap.delete(freq);
  }

  playNote(freq: number, velocity: number, duration: number): void {
    this.startNote(freq, velocity);
    this.stopNote(freq, duration);
  }

  private frequencyToMidiAndPitchBend(freq: number): [number, number] {
    const midiNote = 69 + 12 * Math.log2(freq / 440);
    const nearestMidi = Math.round(midiNote);
    const pitchBend = Math.round((midiNote - nearestMidi) * 8191 / 2) + 8192;

    return [nearestMidi, pitchBend];
  }
}
