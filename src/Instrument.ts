import { default as p5mod } from "p5";
import * as Tone from "tone";

declare var p5: p5mod;

const CLEANUP_LATENCY : number = 0.250;

export interface Instrument {
    // Start playing a note at the given frequency and velocity (0-1)
    startNote(when: number, freq: number, velocity: number): void;

    // Stop playing the note at the given frequency in `secondsFromNow` seconds.
    stopNote(when: number, freq: number): void;

    // Play a note at a given frequency and duration.
    playNote(when: number, duration: number, freq: number, velocity: number): void;
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

export class ToneSynth implements Instrument {
    private oscs: { [freq: number]: AmplitudeControl };

    constructor() {
        this.oscs = {};
    }

    startNote(when: number, freq: number, velocity: number): void {
        this.stopNote(0, freq);

        const env = new Tone.AmplitudeEnvelope(0.05, 1, 0.25, 1).toDestination();
        const osc = new Tone.Oscillator(freq, 'triangle').start();
        osc.volume.value = 10 * Math.log2(velocity) - 10;
        const amp = new AmplitudeControl(osc, env);
        amp.triggerAttack(Tone.now());
        this.oscs[freq] = amp;
    }

    stopNote(when:number, freq: number): void {
        if (this.oscs[freq]) {
            const osc = this.oscs[freq];
            delete this.oscs[freq];

            osc.triggerRelease(when);
        }
    }

    playNote(when: number, duration: number, freq: number, velocity: number): void {
        this.startNote(when, freq, velocity);
        this.stopNote(when + duration, freq);
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

  startNote(when: number, freq: number, velocity: number): void {
    if (!this.midiOutput || this.availableChannels.length === 0) {
      return;
    }

    const channel = this.availableChannels.splice(0, 1)[0];
    this.channelMap.set(freq, channel);

    const [note, pitchBend] = this.frequencyToMidiAndPitchBend(freq);
    this.midiOutput.send([0x90 + channel, note, Math.floor(127*velocity)]);
    this.midiOutput.send([0xE0 + channel, pitchBend & 0x7F, (pitchBend >> 7) & 0x7F]);
  }

  stopNote(when: number, freq: number): void {
    const channel = this.channelMap.get(freq);
    if (!this.midiOutput || channel === undefined) {
      return;
    }

    const [note] = this.frequencyToMidiAndPitchBend(freq);
    this.midiOutput.send(
      [0x90 + channel, note, 0],
      window.performance.now() - Tone.now() + when
    );

    this.availableChannels.push(channel);
    this.channelMap.delete(freq);
  }

  playNote(when: number, duration: number, freq: number, velocity: number): void {
    this.startNote(when, freq, velocity);
    this.stopNote(when + duration, freq);
  }

  private frequencyToMidiAndPitchBend(freq: number): [number, number] {
    const midiNote = 69 + 12 * Math.log2(freq / 440);
    const nearestMidi = Math.round(midiNote);
    const pitchBend = Math.round((midiNote - nearestMidi) * 8191 / 2) + 8192;

    return [nearestMidi, pitchBend];
  }
}
