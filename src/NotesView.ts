import p5 from "p5";
import {QuantizationGrid} from "./QuantizationGrid";
import {Viewport} from "./Viewport";
import {ToneSynth, MPEInstrument, Instrument} from "./Instrument";
import {ExactNumber as N, ExactNumberType} from "exactnumber";

const NOTE_HEIGHT = 10;

interface Note {
  startTime: number;
  endTime: number;
  pitch: ExactNumberType;
  velocity: number; // 0-1
}

interface Point {
  x: number;
  y: ExactNumberType;
}

export class Player {
  private notes: Note[];
  private playingNotes: Note[];
  private playing: boolean;
  private startTime: number;
  private index: number;
  private instrument: Instrument;
  private tempo: number;

  constructor(notes: Note[], tempo: number, instrument: Instrument) {
    this.notes = [...notes];
    this.notes.sort((a,b) => 
        a.startTime < b.startTime ? -1 : a.startTime == b.startTime ? 0 : 1);
    this.playingNotes = [];

    this.playing = false;
    this.instrument = instrument;
    this.tempo = tempo;
  }

  step(p: p5) {
    if (!this.playing) {
        return;
    }
    
    let t = this.getPlayhead(p);

    this.playingNotes = this.playingNotes.filter((note: Note) => {
        if (note.endTime < t) {
            this.instrument.stopNote(note.pitch.toNumber(), 0);
            return false;
        }
        else {
            return true;
        }
    });

    while (this.index < this.notes.length && this.notes[this.index].startTime < t) {
      this.instrument.startNote(this.notes[this.index].pitch.toNumber(), this.notes[this.index].velocity);
      this.playingNotes.push(this.notes[this.index]);
      this.index++;
    }
  }

  play(p: p5, t0: number) {
    this.index = this.notes.findIndex(n => n.startTime >= t0);
    if (this.index == -1)
        return;

    if (this.index < this.notes.length) {
        this.startTime = p.millis() / 1000 - this.notes[this.index].startTime / this.tempo;
    }
   
    this.playing = true;
  }

  stop() {
      for (const n of this.playingNotes) {
          this.instrument.stopNote(n.pitch.toNumber(), 0);
      }
      this.playing = false;
      this.playingNotes = [];
  }

  getPlayhead(p: p5) {
      return this.tempo * (p.millis()/1000 - this.startTime);
  }
};

type SerializedNote = { startTime: number, endTime: number, pitch: string, velocity: number };
type Serialized = { notes: SerializedNote[] };


export class NotesView {
  private quantizationGrid: QuantizationGrid;
  private notes: Note[];
  private isDragging: boolean;
  private dragStart: Point;
  private selectedNotes: Note[];
  private instrument: Instrument;

  constructor(quantizationGrid: QuantizationGrid) {
    this.quantizationGrid = quantizationGrid;
    this.notes = [];
    this.isDragging = false;
    this.dragStart = null;
    this.selectedNotes = [];
    this.instrument = new ToneSynth();
  }

  setInstrument(instrument: Instrument) {
      this.instrument = instrument;
  }

  serialize(): Serialized {
      return {
          notes: this.notes.map((n: Note) => ({ 
              startTime: n.startTime, 
              endTime: n.endTime, 
              pitch: n.pitch.toString(),
              velocity: n.velocity,
          }))
      };
  }

  deserialize(s: Serialized): void {
      this.notes = s.notes.map((n: SerializedNote) => ({
          startTime: n.startTime,
          endTime: n.endTime,
          pitch: N(n.pitch),
          velocity: n.velocity,
      }));
      this.isDragging = false;
      this.dragStart = null;
      this.selectedNotes = [];
  }

  getMouseCoords(p: p5, viewport: Viewport): Point {
    return { 
      x: this.quantizationGrid.snapX(viewport.mapXinv(p.mouseX, p)),
      y: this.quantizationGrid.snapY(viewport.mapYinv(p.mouseY, p))
    };
  }

  getDrawingNote(p: p5, viewport: Viewport): Note {
    const current = this.getMouseCoords(p, viewport);
    return {
      startTime: Math.min(this.dragStart.x, current.x),
      endTime: Math.max(this.dragStart.x, current.x),
      pitch: this.dragStart.y,
      velocity: 0.75,
    };
  }

  handleMousePressed(p: p5, viewport: Viewport): void {
    for (const note of this.notes) {
        const noteBox = this.getNoteBox(note, p, viewport);
        if (noteBox.x0 <= p.mouseX && p.mouseX <= noteBox.xf 
         && noteBox.y0 <= p.mouseY && p.mouseY <= noteBox.yf) {
            this.instrument.playNote(note.pitch.toNumber(), note.velocity, 0.33);
            if (p.keyIsDown(p.SHIFT)) {
                if (this.selectedNotes.includes(note)) {
                    this.selectedNotes = this.selectedNotes.filter(n => n != note);
                }
                else {
                    this.selectedNotes.push(note);
                }
            }
            else {
                this.selectedNotes = [note];
            }
            return;
        }
    }

    if (p.keyIsDown(p.OPTION)) {
        this.quantizationGrid.setYSnap(this.getMouseCoords(p, viewport).y);
        return;
    }

    const coords = this.getMouseCoords(p, viewport);
    this.instrument.startNote(coords.y.toNumber(), 0.75);
    this.isDragging = true;
    this.dragStart = this.getMouseCoords(p, viewport);
  }

  handleMouseReleased(p: p5, viewport: Viewport): void {
    if (this.isDragging) {
      const newNote = this.getDrawingNote(p, viewport);
      this.instrument.stopNote(newNote.pitch.toNumber(), 0);

      if (newNote.startTime != newNote.endTime) {
        this.notes.push(newNote);
        this.selectedNotes = [newNote];
      }
    }
    this.isDragging = false;
  }

  handleKeyPressed(p: p5): void {
      if (p.keyCode === p.ESCAPE) {
          this.selectedNotes = [];
          this.isDragging = false;
          this.dragStart = null;
      }
      else if (p.keyCode === p.BACKSPACE) {
          this.notes = this.notes.filter(n => ! this.selectedNotes.includes(n));
          this.selectedNotes = [];
      }
      else if (p.keyCode == 71) { // g  -- gcd
          if (this.selectedNotes.length > 0) {
              const gcd = this.selectedNotes.reduce((accum,n) => N.gcd(accum, n.pitch), N("0"));
              this.quantizationGrid.setYSnap(gcd);
          }
      }
      else if (p.keyCode == 76) { // l  -- lcm
          if (this.selectedNotes.length > 0) {
              const lcm = this.selectedNotes.reduce((accum,n) => N.lcm(accum, n.pitch), N("1"));
              this.quantizationGrid.setYSnap(lcm);
          }
      }
      else if (p.keyCode == 188) { // ,   -- decrease velocity
          for (let note of this.selectedNotes) {
              note.velocity = note.velocity * 0.8 + 0 * 0.2;
          }
      }
      else if (p.keyCode == 190) { // .   -- increase velocity
          for (let note of this.selectedNotes) {
              note.velocity = note.velocity * 0.8 + 1 * 0.2;
          }
      }
  }

  play(p: p5, viewport: Viewport): Player {
      const player = new Player(this.notes, 4, this.instrument);
      player.play(p, viewport.mapXinv(0, p));
      return player;
  }

  getNoteBox(note: Note, p:p5, viewport: Viewport): { x0: number, y0: number, xf: number, yf: number } {
      return {
          x0: viewport.mapX(note.startTime, p),
          y0: viewport.mapY(note.pitch.toNumber(), p) - NOTE_HEIGHT / 2,
          xf: viewport.mapX(note.endTime, p), 
          yf: viewport.mapY(note.pitch.toNumber(), p) + NOTE_HEIGHT / 2
      }
  }

  draw(p: p5, viewport: Viewport): void {
    p.colorMode(p.RGB);
    const drawNote = (note: Note, current: boolean) => {
      let v = note.velocity;

      if (current || this.selectedNotes.includes(note)) {
        p.strokeWeight(2);
        p.stroke(255, 128, 0);
        p.fill(255*v, 128*v, 0);
      }
      else {
        p.strokeWeight(1);
        p.stroke(0, 0, 0);
        p.fill(0, v*204, v*255);
      }

      const noteBox = this.getNoteBox(note, p, viewport);
      p.rect(noteBox.x0, noteBox.y0, noteBox.xf - noteBox.x0, noteBox.yf - noteBox.y0);
    };

    if (this.isDragging) {
        drawNote(this.getDrawingNote(p, viewport), true);
    }

    for (const note of this.notes) {
        drawNote(note, false);
    }
  }
}
