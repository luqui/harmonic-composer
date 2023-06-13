import { default as p5mod } from "p5";
import p5sound from "p5/lib/addons/p5.sound";

declare var p5: p5mod;

const RELEASE_TIME : number = 0.02;

export interface Instrument {
    startNote(freq: number): void;
    stopNote(freq: number, secondsFromNow: number): void;
    playNote(freq: number, duration: number): void;
}

export class ToneSynth implements Instrument {
    private oscs: { [freq: number]: { osc: p5mod.Oscillator, env: p5mod.Envelope } };

    constructor() {
        this.oscs = {};
        console.log(p5sound);
    }

    startNote(freq: number): void {
        this.stopNote(freq, 0);

        // Horrible typescript fighting.

        // @ts-ignore
        const osc = new p5.Oscillator(freq, 'triangle');
        // @ts-ignore
        const env = new p5.Envelope();
        env.setADSR(0.05, 2, 0.25, RELEASE_TIME);
        osc.start();
        env.triggerAttack(osc, 0);
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

    playNote(freq: number, duration: number): void {
        this.startNote(freq);
        this.stopNote(freq, duration);
    }
};
