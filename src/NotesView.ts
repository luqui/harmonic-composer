import p5 from "p5";
import {QuantizationGrid} from "./QuantizationGrid";
import {Viewport, LogViewport} from "./Viewport";
import {ToneSynth, MPEInstrument, Instrument} from "./Instrument";
import {Scheduler} from "./Scheduler";
import * as Commands from "./Commands";
import * as Utils from "./Utils";
import * as FileType from "./FileType";
import {ExactNumber as N, ExactNumberType} from "exactnumber";
import * as Tone from "tone";

const NOTE_HEIGHT = 10;

export interface Note {
  startTime: number;
  endTime: number;
  pitch: ExactNumberType;
  velocity: number; // 0-1
}


interface Point {
  x: number;
  y: ExactNumberType;
}

// Bit of a hack to make it so repeated notes don't futz things up.
// Doesn't work 100%.
const NOTE_END_EPSILON = 0.05;

export class Player {
  private notes: Note[];
  private playingNotes: Note[];
  private startTime: number;
  private playheadStart: number;
  private scheduler: Scheduler;
  private instrument: Instrument;
  private tempo: number;

  constructor(notes: Note[], tempo: number, instrument: Instrument, playheadStart: number) {
    this.notes = notes;
    this.playingNotes = [];

    this.scheduler = new Scheduler(0.2);
    this.instrument = instrument;

    this.startTime = Tone.now();
    this.playheadStart = playheadStart;
    this.tempo = tempo;

    for (const note of this.notes) {
        const pitch = note.pitch.toNumber();
        if (note.startTime >= playheadStart) {
            this.scheduler.schedule(this.startTime + (note.startTime - playheadStart) / tempo, (when: number) => {
                instrument.startNote(when, pitch, note.velocity);
            });
            this.scheduler.schedule(this.startTime + (note.endTime - playheadStart) / tempo - NOTE_END_EPSILON, (when: number) => {
                instrument.stopNote(when, pitch);
            });
        }
    }
  }

  stop() {
      this.scheduler.stop((when: number) => { 
          this.instrument.stopAllNotes(when);
      });
  }

  getPlayhead(): number {
      return (Tone.now() - this.startTime) * this.tempo + this.playheadStart;
  }
};

export class NotesView {
  private p5: p5;
  private quantizationGrid: QuantizationGrid;
  private viewport: Viewport;
  private notes: Note[];
  private selectedNotes: Note[];
  private instrument: Instrument;
  private commands: Commands.Runner;

  constructor(p: p5) {
    this.p5 = p;
    this.viewport = new LogViewport(0, 36, 40, 108);
    this.quantizationGrid = new QuantizationGrid(1, N("216"));
    this.notes = [];
    this.selectedNotes = [];
    this.instrument = new ToneSynth();
    this.commands = new Commands.Runner();

    this.registerCommands();
    document.getElementById('help-container').appendChild(this.commands.getHelpHTML());
  }
  
  setInstrument(instrument: Instrument) {
      this.instrument = instrument;
  }

  serialize(): FileType.Score {
      return {
          notes: this.notes.map((n: Note) => ({ 
              startTime: n.startTime, 
              endTime: n.endTime, 
              pitch: n.pitch.toString(),
              velocity: n.velocity,
          }))
      };
  }

  deserialize(obj: object): void {
      const score = FileType.loadScore(obj);
      this.notes = score.notes.map((n: FileType.Note) => ({
          startTime: n.startTime,
          endTime: n.endTime,
          pitch: N(n.pitch),
          velocity: n.velocity,
      }));
      this.selectedNotes = [];
  }

  getMouseCoords(): Point {
    return { 
      x: this.quantizationGrid.snapX(this.viewport.mapXinv(this.p5.mouseX, this.p5)),
      y: this.quantizationGrid.snapY(this.viewport.mapYinv(this.p5.mouseY, this.p5))
    };
  }

  getMouseCoordsUnquantized(): { x: number, y: number} {
    return { 
      x: this.viewport.mapXinv(this.p5.mouseX, this.p5),
      y: this.viewport.mapYinv(this.p5.mouseY, this.p5),
    };
  }

  handleMousePressed(): void {
    this.commands.dispatch('mouseDown');
  }

  handleMouseReleased(): void {
    this.commands.dispatch('mouseUp');
  }
  
  registerCommands() {
      const simpleKey = (name: string, category: string, key: number, cb: () => void) => {
          this.commands.register(name, category, async (cx:Commands.Context) => {
              await cx.listen(cx.key(this.p5, key));
              await cx.action(cb);
          });
      };

      const mustHaveSelection = (name: string) => {
          if (this.selectedNotes.length === 0) {
              alert(name + ': At least one note must be selected');
              return false;
          }
          return true;
      };
      
      simpleKey('h - Show/hide help', 'View', 72, async () => {
          const style = document.getElementById('help-container').style;
          if (style.display === 'none') {
              style.display = 'block';
          }
          else {
              style.display = 'none';
          }
      });


      this.commands.register('spacebar - play/stop', 'Transport', async (cx:Commands.Context) => {
          // Dummy, handled in Sketch.ts
          await cx.listen({});
      });
      
      this.commands.register('option+click - select fundamental (note)', 'hidden', async (cx:Commands.Context) => {
          const note = await cx.listen(cx.when(() => this.p5.keyIsDown(this.p5.OPTION), this.listenSelectNote(cx)));
          await cx.action(() => {
               this.quantizationGrid.setYSnap(note.pitch);
          });
      });
      
      this.commands.register('option+click - set fundamental', 'View', async (cx:Commands.Context) => {
          await cx.listen(cx.when(() => this.p5.keyIsDown(this.p5.OPTION), cx.mouseDown()));
          await cx.action(() => {
               this.quantizationGrid.setYSnap(this.getMouseCoords().y);
          });
      });

      simpleKey('g - select common subharmonic ("gcd")', 'View', 71, () => {
          if (! mustHaveSelection('GCD')) return;
          const gcd = this.selectedNotes.reduce((accum,n) => N.gcd(accum, n.pitch).normalize(), N("0"));
          this.quantizationGrid.setYSnap(gcd);
      });

      simpleKey('l - select common harmonic ("lcm")', 'View', 76, () => {
          if (! mustHaveSelection('LCM')) return;
          const lcm = this.selectedNotes.reduce((accum,n) => N.lcm(accum, n.pitch).normalize(), N("1"));
          this.quantizationGrid.setYSnap(lcm);
      });
      
      simpleKey('Backspace - delete notes', 'Edit', 8, () => {
          if (! mustHaveSelection('Delete')) return;
          this.notes = this.notes.filter(n => ! this.selectedNotes.includes(n));
          this.selectedNotes = [];
      });

      simpleKey(', - decreate velocity', 'Edit', 188, () => {
          if (! mustHaveSelection('decrease velocity')) return;
          for (let note of this.selectedNotes) {
              note.velocity = note.velocity * 0.8 + 0 * 0.2;
          }
      });

      simpleKey('. - increase velocity', 'Edit', 190, () => {
          if (! mustHaveSelection('decrease velocity')) return;
          for (let note of this.selectedNotes) {
              note.velocity = note.velocity * 0.8 + 1 * 0.2;
          }
      });

      simpleKey('z - shift pitch grid down by 1 harmonic', 'View', 90, () => {
          if (this.selectedNotes.length !== 1) {
              alert('Pivot: exactly one note must be selected');
              return;
          }
          const note = this.selectedNotes[0];
          const z = note.pitch.div(this.quantizationGrid.getYSnap()).normalize();
          if (z.isInteger()) {
              this.quantizationGrid.setYSnap(note.pitch.div(z.add(N("1"))).normalize());
          }
          else if (z.inv().isInteger()) {
              this.quantizationGrid.setYSnap(note.pitch.mul(z.inv().sub(N("1"))).normalize());
          }
          else {
              alert('Pivot: selected note must be on grid line');
          }
      });

      simpleKey('a - shift pitch gtid up by 1 harmonic', 'View', 65, () => {
          if (this.selectedNotes.length != 1) {
              //alert('Pivot: exactly one note must be selected');
              return;
          }
          const note = this.selectedNotes[0];
          const z = note.pitch.div(this.quantizationGrid.getYSnap()).normalize();
          if (z.inv().isInteger()) {
              this.quantizationGrid.setYSnap(note.pitch.mul(z.inv().add(N("1"))).normalize());
          }
          else if (z.isInteger()) {
              this.quantizationGrid.setYSnap(note.pitch.div(z.sub(N("1"))).normalize());
          }
          else {
              alert('Pivot: selected note must be on grid line');
          }
      });

      simpleKey('c - construct chord', 'Tools', 67, () => {
          if (! mustHaveSelection('Chord')) return;

          const ratioString = window.prompt('Enter a ratio string such as 2:3:4');
          if (ratioString === null) {
              return;
          }

          const componentStrings = ratioString.split(':');
          let ratios: number[] = [];
          for (const component of componentStrings) {
              if (! component.match(/^\d+$/) || Number(component) == 0) {
                  alert('Chord: Invalid ratio string. I don\'t understand "' + component + '"');
                  return;
              }
              ratios.push(Number(component));
          }
          const [r0] = ratios.splice(0, 1);

          const sel = this.selectedNotes;
          this.selectedNotes = [];
          for (const note of sel) {
              for (const r of ratios) {
                  const newNote = {
                      startTime: note.startTime,
                      endTime: note.endTime,
                      pitch: note.pitch.div(r0).mul(r).normalize(),
                      velocity: note.velocity
                  };
                  this.notes.push(newNote);
                  this.selectedNotes.push(newNote);
              }
          }
      });

      this.commands.register('arrow keys - scroll', 'View', async (cx: Commands.Context) => {
          const keyCode = await cx.listen({
              keyDown: () => {
                  if ([37,38,39,40].includes(this.p5.keyCode))
                      return { control: 'CONSUME', value: this.p5.keyCode };
                  else
                      return { control: 'REPEAT' };
              }
          });
          await cx.action(() => {
              if (keyCode == 37) // <-
                  this.viewport.translateX(-0.25);
              else if (keyCode == 39) // ->
                  this.viewport.translateX(-0.25);
              else if (keyCode == 38) // ^
                  this.viewport.translateY(0.25);
              else if (keyCode == 40) 
                  this.viewport.translateY(-0.25);
              else
                  console.log("Impossible keycode");
          });
      });

      this.commands.register('-, = - zoom pitch axis  (ctrl+ for time)', 'View', async (cx: Commands.Context) => {
          const [keyCode, ctrl] = await cx.listen({
              keyDown: () => {
                  if ([187,189].includes(this.p5.keyCode))
                      return { control: 'CONSUME', value: [this.p5.keyCode, this.p5.keyIsDown(this.p5.CONTROL)] };
                  else
                      return { control: 'REPEAT' };
              }
          });
          await cx.action(() => {
              if (ctrl) {
                  if (keyCode == 187) {
                      this.viewport.zoomX(3/2, this.getMouseCoordsUnquantized().x);
                  }
                  else if (keyCode == 189) {
                      this.viewport.zoomX(2/3, this.getMouseCoordsUnquantized().x);
                  }
              }
              else {
                  if (keyCode == 187) {
                      this.viewport.zoomY(3/2, this.getMouseCoordsUnquantized().y);
                  }
                  else if (keyCode == 189) {
                      this.viewport.zoomY(2/3, this.getMouseCoordsUnquantized().y);
                  }
              }
          });
      });

      this.commands.register('(shift+) 2 - divide (multiply) fundamental by two', 'View', async (cx: Commands.Context) => {
          await cx.listen(cx.when(() => ! this.p5.keyIsDown(this.p5.CONTROL), cx.key(this.p5, 50)));
          if (this.p5.keyIsDown(this.p5.SHIFT)) {
              await cx.action(() => 
                  this.quantizationGrid.setYSnap(this.quantizationGrid.getYSnap().mul(N(2)).normalize()));
          }
          else {
              await cx.action(() => 
                  this.quantizationGrid.setYSnap(this.quantizationGrid.getYSnap().div(N(2)).normalize()));
          }
      });
      
      this.commands.register('(shift+) 3 - divide (multiply) fundamental by three', 'View', async (cx: Commands.Context) => {
          await cx.listen(cx.when(() => ! this.p5.keyIsDown(this.p5.CONTROL), cx.key(this.p5, 51)));
          if (this.p5.keyIsDown(this.p5.SHIFT)) {
              await cx.action(() => 
                  this.quantizationGrid.setYSnap(this.quantizationGrid.getYSnap().mul(N(3)).normalize()));
          }
          else {
              await cx.action(() => 
                  this.quantizationGrid.setYSnap(this.quantizationGrid.getYSnap().div(N(3)).normalize()));
          }
      });
      
      this.commands.register('ctrl+(shift+) 2 - divide (multiply) time grid by two', 'View', async (cx: Commands.Context) => {
          await cx.listen(cx.when(() => this.p5.keyIsDown(this.p5.CONTROL), cx.key(this.p5, 50)));
          if (this.p5.keyIsDown(this.p5.SHIFT)) {
              await cx.action(() => 
                  this.quantizationGrid.setXSnap(this.quantizationGrid.getXSnap() * 2));
          }
          else {
              await cx.action(() => 
                  this.quantizationGrid.setXSnap(this.quantizationGrid.getXSnap() / 2));
          }
      });
      
      this.commands.register('ctrl+(shift+) 3  - divide (multiply) time grid by three', 'View', async (cx: Commands.Context) => {
          await cx.listen(cx.when(() => this.p5.keyIsDown(this.p5.CONTROL), cx.key(this.p5, 51)));
          if (this.p5.keyIsDown(this.p5.SHIFT)) {
              await cx.action(() => 
                  this.quantizationGrid.setXSnap(this.quantizationGrid.getXSnap() * 3));
          }
          else {
              await cx.action(() => 
                  this.quantizationGrid.setXSnap(this.quantizationGrid.getXSnap() / 3));
          }
      });

      this.commands.register('ctrl+s - save to location bar', 'File', async (cx: Commands.Context) => {
          await cx.listen(cx.when(() => this.p5.keyIsDown(this.p5.CONTROL), cx.key(this.p5, 83)));
          await cx.action(() => {
              document.location.hash = Buffer.from(JSON.stringify(this.serialize())).toString("base64");
          });
      });


      this.commands.register('shift+click - add/remove note from selection', 'Edit', async (cx: Commands.Context) => {
          const note = await cx.listen(
                                cx.when(() => this.p5.keyIsDown(this.p5.SHIFT), 
                                        this.listenSelectNote(cx)));
          if (this.selectedNotes.includes(note)) {
              await cx.action(() => { 
                  this.selectedNotes = this.selectedNotes.filter(n => n != note) });
          }
          else {
              await cx.action(() => {
                  this.instrument.playNote(Tone.now(), 0.33, note.pitch.toNumber(), note.velocity);
                  this.selectedNotes.push(note);
              });
          }
      });


      this.commands.register('drag handles - resize notes', 'hidden', async (cx: Commands.Context) => {
          const onHandle = (note: Note) => {
              const noteBox = this.getNoteBox(note);
              if (noteBox.xf - 10 <= this.p5.mouseX && this.p5.mouseX <= noteBox.xf
                    && noteBox.y0 <= this.p5.mouseY && this.p5.mouseY <= noteBox.yf) {
                  return 'RIGHT';
              }
              else if (noteBox.x0 <= this.p5.mouseX && this.p5.mouseX <= noteBox.x0 + 10
                    && noteBox.y0 <= this.p5.mouseY && this.p5.mouseY <= noteBox.yf) {
                  return 'LEFT';
              }
              else {
                  return false;
              }
          };
          const [note, handle] = await cx.listen({
              draw: () => {
                  for (const note of this.notes) {
                      if (onHandle(note)) {
                          this.p5.cursor('col-resize');
                          return { control: 'REPEAT' };
                      }
                  }
                  return { control: 'REPEAT' };
              },
              mouseDown: () => {
                  for (const note of this.notes) {
                      const handle = onHandle(note);
                      if (handle) {
                          return { control: 'CONSUME', value: [note, handle] };
                      }
                  }
                  return { control: 'REPEAT' };
              }
          });
          const startCoords = this.getMouseCoords();
          const selection = this.selectedNotes.includes(note) ? this.selectedNotes : [note];
          const refTimes = selection.map(n => ({ startTime: n.startTime, endTime: n.endTime }));

          await cx.listen({
              action: { priority: 0, value: () => {
                  const coords = this.getMouseCoords();

                  for (let i = 0; i < selection.length; i++) {
                      if (handle === 'LEFT') {
                          const newStart = refTimes[i].startTime + coords.x - startCoords.x;
                          if (newStart < selection[i].endTime) {
                              selection[i].startTime = newStart;
                          }
                          else {
                              selection[i].startTime = refTimes[i].endTime - this.quantizationGrid.getXSnap();
                          }
                      }
                      else {
                          const newEnd = refTimes[i].endTime + coords.x - startCoords.x;
                          if (newEnd > selection[i].startTime) {
                              selection[i].endTime = newEnd;
                          }
                          else {
                              selection[i].endTime = refTimes[i].startTime + this.quantizationGrid.getXSnap();
                          }
                      }
                  }
                  return { control: 'REPEAT' };
              } },
              draw: () => {
                  this.p5.cursor('col-resize');
                  return { control: 'REPEAT' };
              },
              mouseUp: () => {
                  return { control: 'CONSUME', value: undefined };
              },
          });
      });
      

      this.commands.register('d - duplicate notes', 'Tools', async (cx: Commands.Context) => {
          await cx.listen(cx.when(() => this.selectedNotes.length != 0, cx.key(this.p5, 68)));  // d

          const notes = await cx.action(() => {
              const r = [...this.selectedNotes];
              this.selectedNotes = [];
              return r;
          });
          const initialMouse: Point = this.getMouseCoords();
          const translate = (note: Note, mouse: Point) => ({
              startTime: note.startTime + mouse.x - initialMouse.x,
              endTime: note.endTime + mouse.x - initialMouse.x,
              pitch: note.pitch,
              velocity: note.velocity,
          });
          await cx.listen({
              draw: () => {
                  const mouse = this.getMouseCoords();
                  for (const note of notes) {
                      this.drawNote(translate(note, mouse), true);
                  }
                  return { control: 'REPEAT' };
              },
              mouseDown: () => {
                  return { control: 'CONSUME', value: undefined };
              },
              keyDown: () => {
                  if (this.p5.keyCode == 27) { // esc
                      return { control: 'CANCEL' };
                  }
                  else {
                      return { control: 'REPEAT' };
                  }
              },
          });
          await cx.action(() => {
              const mouse = this.getMouseCoords();
              this.selectedNotes = notes.map(n => translate(n, mouse));
              this.notes = this.notes.concat(this.selectedNotes);
          });
      });

      
      this.commands.register('click and drag - select and move notes', 'hidden', async (cx: Commands.Context) => {
          const note = await cx.listen(this.listenSelectNote(cx));
          this.instrument.playNote(Tone.now(), 0.33, note.pitch.toNumber(), note.velocity);

          let lastMouse: Point = await cx.action(() => {
              if (! this.selectedNotes.includes(note)) {
                  this.selectedNotes = [note];
              }
              return this.getMouseCoords();
          });

          await cx.listen({
              action: { priority: 0, value: () => {
                  const coords = this.getMouseCoords();
                  for (const n of this.selectedNotes) {
                      n.startTime += coords.x - lastMouse.x;
                      n.endTime += coords.x - lastMouse.x;
                      n.pitch = n.pitch.mul(coords.y.div(lastMouse.y)).normalize();
                  }
                  lastMouse = coords;
                  return { control: 'REPEAT' };
              } },
              mouseUp: () => {
                  return { control: 'CONSUME', value: undefined };
              }
          });
      });

      this.commands.register('click and drag - create new note', 'hidden', async (cx: Commands.Context) => {
          await cx.listen(cx.when(() => ! this.p5.keyIsDown(this.p5.SHIFT), cx.mouseDown()));
          const startCoords: Point  = await cx.action(() => {
              const coords = this.getMouseCoords();

              this.selectedNotes = [];
              this.instrument.playNote(Tone.now(), 0.33, coords.y.toNumber(), 0.75);
              return coords;
          });

          const mkNote = () => { 
              const coords = this.getMouseCoords();
              return {
                  startTime: Math.min(startCoords.x, coords.x),
                  endTime: Math.max(startCoords.x, coords.x),
                  pitch: startCoords.y,
                  velocity: 0.75,
              };
          };

          await cx.listen({
              draw: () => {
                  this.drawNote(mkNote(), true);
                  return { control: 'REPEAT' };
              },
              mouseUp: () => {
                  const note = mkNote();
                  if (note.startTime != note.endTime) {
                      this.notes.push(note);
                      this.selectedNotes = [note];
                  }
                  return { control: 'CONSUME', value: undefined };
              }
          });
      });

      this.commands.register('click and drag - box select notes', 'hidden', async (cx: Commands.Context) => {
          await cx.listen(cx.when(
              () => this.p5.keyIsDown(this.p5.SHIFT) && this.mouseOverNote() === null, 
              cx.mouseDown()));
          const startCoords = this.getMouseCoordsUnquantized();
          const startingNotes = this.selectedNotes;

          await cx.listen({
              action: { priority: 0, value: () => {
                  const boxEnd = this.getMouseCoordsUnquantized();
                  const minX = Math.min(startCoords.x, boxEnd.x);
                  const maxX = Math.max(startCoords.x, boxEnd.x);
                  const minY = Math.min(startCoords.y, boxEnd.y);
                  const maxY = Math.max(startCoords.y, boxEnd.y);
              
                  this.selectedNotes = Utils.dedup(startingNotes.concat(this.notes.filter(note => {
                      const pitch = note.pitch.toNumber();
                      return (Utils.intervalIntersects(minX, maxX, note.startTime, note.endTime) 
                           && Utils.intervalIntersects(minY, maxY, pitch, pitch));
                  })));

                  return { control: 'REPEAT' }
              } },
              draw: () => {
                  const boxEnd = this.getMouseCoordsUnquantized();
                  this.p5.strokeWeight(2);
                  this.p5.stroke(255, 128, 0);
                  this.p5.fill(255, 128, 0, 128);
                  const x0 = this.viewport.mapX(startCoords.x, this.p5);
                  const y0 = this.viewport.mapY(startCoords.y, this.p5)
                  this.p5.rect(x0, y0, this.viewport.mapX(boxEnd.x, this.p5) - x0, this.viewport.mapY(boxEnd.y, this.p5) - y0);
                  return { control: 'REPEAT' }
              },
              mouseUp: () => {
                  return { control: 'CONSUME', value: undefined }
              },
          });
      });
  }

  listenSelectNote(cx: Commands.Context): Commands.Listener<Note> {
      return {
              mouseDown: () => {
                  const note = this.mouseOverNote();
                  if (note === null) {
                      return { control: 'REPEAT' };
                  }
                  else {
                      return { control: 'CONSUME', value: note };
                  }
              }
          };
  }

  mouseOverNote(): Note {
      for (const note of this.notes) {
          const noteBox = this.getNoteBox(note);
          if (noteBox.x0 <= this.p5.mouseX && this.p5.mouseX <= noteBox.xf 
           && noteBox.y0 <= this.p5.mouseY && this.p5.mouseY <= noteBox.yf) {
              return note;
          }
      }
      return null;
  }


  handleKeyPressed(): void {
      this.commands.dispatch('keyDown');
  }

  play(): Player {
      return new Player(this.notes, 4, this.instrument, this.viewport.mapXinv(0, this.p5));
  }

  getNoteBox(note: Note): { x0: number, y0: number, xf: number, yf: number } {
      return {
          x0: this.viewport.mapX(note.startTime, this.p5),
          y0: this.viewport.mapY(note.pitch.toNumber(), this.p5) - NOTE_HEIGHT / 2,
          xf: this.viewport.mapX(note.endTime, this.p5), 
          yf: this.viewport.mapY(note.pitch.toNumber(), this.p5) + NOTE_HEIGHT / 2
      }
  }

  getRatioString(notes: Note[]) {
      const gcd = notes.reduce((accum,n) => N.gcd(accum, n.pitch).normalize(), N("0"));
      const nums = notes.map(n => n.pitch.div(gcd).toNumber());
      return [...new Set(nums)].sort((a,b) => a < b ? -1 : a > b ? 1 : 0).join(':');
  }

  drawPlayhead(playhead: number) {
      this.p5.colorMode(this.p5.RGB);
      this.p5.strokeWeight(2);
      this.p5.stroke(0, 128, 0);
      this.p5.line(this.viewport.mapX(playhead, this.p5), 0, this.viewport.mapX(playhead, this.p5), this.p5.height);
  }
  
  drawNote(note: Note, current: boolean): void {
      let v = note.velocity;

      if (current || this.selectedNotes.includes(note)) {
        this.p5.strokeWeight(2);
        this.p5.stroke(255, 128, 0);
        this.p5.fill(255*v, 128*v, 0);
      }
      else {
        this.p5.strokeWeight(1);
        this.p5.stroke(0, 0, 0);
        this.p5.fill(0, v*204, v*255);
      }

      const noteBox = this.getNoteBox(note);
      this.p5.rect(noteBox.x0, noteBox.y0, noteBox.xf - noteBox.x0, noteBox.yf - noteBox.y0);
  }

  draw(): void {
    this.p5.cursor('auto');  // to be overridden by commands' draw maybe
    this.quantizationGrid.drawGrid(this.p5, this.viewport);

    this.p5.colorMode(this.p5.RGB);

    for (const note of this.notes) {
        this.drawNote(note, false);
    }

    this.commands.dispatch('draw');

    if (this.selectedNotes.length >= 2) {
        this.p5.fill(0, 0, 0);
        this.p5.stroke(0, 0, 0);
        this.p5.strokeWeight(1);
        this.p5.textAlign(this.p5.RIGHT);
        this.p5.text(this.getRatioString(this.selectedNotes), 0, 10, this.p5.width, 50);
    }
    
  }
}
