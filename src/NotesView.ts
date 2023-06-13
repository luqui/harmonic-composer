import p5 from "p5";
import {QuantizationGrid} from "./QuantizationGrid";
import {Viewport} from "./Viewport";
import {Instrument} from "./Instrument";
import {ExactNumber as N, ExactNumberType} from "exactnumber";

const NOTE_HEIGHT = 10;

interface Note {
  startTime: number;
  endTime: number;
  pitch: ExactNumberType;
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

  constructor(notes: Note[], tempo: number) {
    this.notes = [...notes];
    this.notes.sort((a,b) => 
        a.startTime < b.startTime ? -1 : a.startTime == b.startTime ? 0 : 1);
    this.playingNotes = [];

    this.playing = false;
    this.instrument = new Instrument();
    this.tempo = tempo;
  }

  step(p: p5) {
    if (!this.playing) {
        return;
    }

    let t = this.tempo * (p.millis()/1000 - this.startTime);
    while (this.index < this.notes.length && this.notes[this.index].startTime < t) {
      this.instrument.startNote(this.notes[this.index].pitch.toNumber());
      this.playingNotes.push(this.notes[this.index]);
      this.index++;
    }

    this.playingNotes = this.playingNotes.filter((note: Note) => {
        if (note.endTime < t) {
            this.instrument.stopNote(note.pitch.toNumber(), 0);
            return false;
        }
        else {
            return true;
        }
    });
  }

  play(p: p5) {
    this.playing = true;
    this.startTime = p.millis()/1000;
    this.index = 0;
  }

  stop() {
      for (const n of this.playingNotes) {
          this.instrument.stopNote(n.pitch.toNumber(), 0);
      }
      this.playing = false;
      this.playingNotes = [];
  }
};


export class NotesView {
  private quantizationGrid: QuantizationGrid;
  private notes: Note[];
  private isDragging: boolean;
  private dragStart: Point;
  private selectedNote: Note;
  private instrument: Instrument;

  private runningGCD: ExactNumberType; 

  constructor(quantizationGrid: QuantizationGrid) {
    this.quantizationGrid = quantizationGrid;
    this.notes = [];
    this.isDragging = false;
    this.dragStart = null;
    this.selectedNote = null;
    this.instrument = new Instrument()
    this.runningGCD = N("0");
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
      pitch: this.dragStart.y
    };
  }

  handleMousePressed(p: p5, viewport: Viewport): void {
    for (const note of this.notes) {
        const noteBox = this.getNoteBox(note, p, viewport);
        if (noteBox.x0 <= p.mouseX && p.mouseX <= noteBox.xf 
         && noteBox.y0 <= p.mouseY && p.mouseY <= noteBox.yf) {
            if (p.keyIsDown(p.SHIFT)) {
                this.runningGCD = N.gcd(this.runningGCD, note.pitch);
                this.quantizationGrid.setYSnap(this.runningGCD);
            }
            else {
                this.instrument.playNote(note.pitch.toNumber(), 0.33);
                this.selectedNote = note;
            }
            return;
        }
    }

    if (p.keyIsDown(p.SHIFT)) {
        this.runningGCD = N.gcd(this.runningGCD, this.getMouseCoords(p, viewport).y);
        this.quantizationGrid.setYSnap(this.runningGCD);
        return;
    }

    const coords = this.getMouseCoords(p, viewport);
    this.instrument.startNote(coords.y.toNumber());
    this.isDragging = true;
    this.dragStart = this.getMouseCoords(p, viewport);
  }

  handleMouseReleased(p: p5, viewport: Viewport): void {
    if (this.isDragging) {
      const newNote = this.getDrawingNote(p, viewport);
      this.instrument.stopNote(newNote.pitch.toNumber(), 0);

      if (newNote.startTime != newNote.endTime) {
        this.notes.push(newNote);
        this.selectedNote = newNote;
      }
    }
    this.isDragging = false;
  }

  handleKeyPressed(p: p5): void {
      if (p.keyCode === p.ESCAPE) {
          this.selectedNote = null;
          this.isDragging = false;
          this.dragStart = null;
      }
      else if (p.keyCode === p.BACKSPACE) {
          this.notes = this.notes.filter(n => n !== this.selectedNote);
          this.selectedNote = null;
      }
  }

  handleKeyReleased(p: p5): void {
      if (p.keyCode === p.SHIFT) {
          this.runningGCD = N("0");
      }
  }

  play(p: p5): Player {
      const player = new Player(this.notes, 4);
      player.play(p);
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
    const drawNote = (note: Note) => {
      if (note == this.selectedNote) {
        p.fill(0, 204, 255);
      }
      else {
        p.fill(0, 102, 153);
      }
      const noteBox = this.getNoteBox(note, p, viewport);
      p.rect(noteBox.x0, noteBox.y0, noteBox.xf - noteBox.x0, noteBox.yf - noteBox.y0);
    };

    if (this.isDragging) {
        drawNote(this.getDrawingNote(p, viewport));
    }

    for (const note of this.notes) {
        drawNote(note);
    }
  }
}
