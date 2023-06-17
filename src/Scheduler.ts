import Heap from "heap-js";
import * as Tone from "tone";

type Event = { time: number, action: (when: number) => void };

export class Scheduler {
    private clock: Tone.Clock;
    private resolution: number;
    private heap: Heap<Event>;
    private time: number;

    private willStop: (when: number) => void;

    constructor(resolution: number) {
        this.resolution = resolution;
        this.clock = new Tone.Clock((when: number) => { this.tick() }, 1/this.resolution);
        this.clock.start();
        this.heap = new Heap((a,b) => a.time - b.time);
        this.time = null;
        this.willStop = null;
    }

    stop(cleanup: (when: number) => void): void {
        this.willStop = cleanup;
    }

    tick(): void {
        this.time = Tone.now();
        const nextTime = this.time + this.resolution;

        if (this.willStop) {
            this.clock.stop();
            this.willStop(nextTime);
            return;
        }

        while (true) {
            const event = this.heap.peek();
            if (! event || event.time >= nextTime) {
                break;
            }
            this.heap.pop();
            event.action(event.time);
        }
        this.time = nextTime;
    }

    schedule(when: number, action: (when: number) => void) {
        if (when < Tone.now()) {
            action(Tone.now());
        }
        else {
            this.heap.push({ time: when, action: action });
        }
    }
}

