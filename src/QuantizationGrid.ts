import {Viewport} from "./Viewport";
import p5 from "p5";

export class QuantizationGrid {
    private xsnap: number;
    private ysnap: number;

    constructor(xsnap: number, ysnap: number) {
        this.xsnap = xsnap;
        this.ysnap = ysnap;
    }

    setXSnap(xsnap: number) {
        this.xsnap = xsnap;
    }

    snapX(x: number): number {
        if (this.xsnap == 0)
            return x;

        return this.xsnap * Math.round(x/this.xsnap);
    }

    setYSnap(ysnap: number) {
        this.ysnap = ysnap;
    }

    snapY(y: number): number {
        if (this.ysnap == 0)
            return y;

        if (y >= this.ysnap) {
            return this.ysnap * Math.round(y/this.ysnap);
        }
        else {
            return this.ysnap / Math.round(this.ysnap/y);
        }
    }

    drawGrid(p: p5, viewport: Viewport) {
        p.colorMode(p.HSB);

        p.stroke(0, 0, 85);
        p.strokeWeight(1);
        
        if (this.xsnap != 0) {
            const x0 = viewport.mapXinv(0, p);
            const xf = viewport.mapXinv(p.width, p);
            for (let x = x0; x < xf; x += this.xsnap) {
              p.line(viewport.mapX(x, p), 0, viewport.mapX(x, p), p.height);
            }
        }

        if (this.ysnap != 0) {
            // upper lines
            {
                const y0 = this.ysnap;
                const yf = viewport.mapYinv(0, p);
                for (let y = y0, i = 1; y < yf; y += this.ysnap, i++) {
                  p.stroke((256*Math.log2(i)) % 256, 128, 196);
                  p.line(0, viewport.mapY(y, p), p.width, viewport.mapY(y, p));
                }
            }

            // lower lines
            {
                const yBottom = viewport.mapYinv(p.height, p);
                const y0 = this.ysnap;
                for (let n = 2; y0 / n > 1 && y0 / n > yBottom; n++) {
                  p.stroke((256*Math.log2(n)) % 256, 128, 196);
                  p.line(0, viewport.mapY(y0 / n, p), p.width, viewport.mapY(y0 / n, p));
                }
            }
        }
    }
}
