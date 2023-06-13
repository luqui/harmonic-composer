import {Viewport} from "./Viewport";
import p5 from "p5";
import {ExactNumberType} from "exactnumber";

export class QuantizationGrid {
    private xsnap: number;
    private ysnap: ExactNumberType;

    constructor(xsnap: number, ysnap: ExactNumberType) {
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

    setYSnap(ysnap: ExactNumberType) {
        this.ysnap = ysnap;
    }

    snapY(y: number): ExactNumberType {
        if (this.ysnap.lte(y)) {
            return this.ysnap.mul(this.ysnap.inv().mul(y).round());
        }
        else {
            return this.ysnap.div(this.ysnap.div(y).round());
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

        // upper lines
        {
            const y0 = this.ysnap.toNumber();
            const yf = viewport.mapYinv(0, p);
            for (let y = y0, i = 1; y < yf; y += y0, i++) {
              p.strokeWeight(3 * (this.twoDivs(i) + 1) / Math.log2(i));
              p.stroke((256*Math.log2(i)) % 256, 128, 196);
              p.line(0, viewport.mapY(y, p), p.width, viewport.mapY(y, p));
            }
        }

        // lower lines
        {
            const yBottom = viewport.mapYinv(p.height, p);
            const y0 = this.ysnap.toNumber();
            for (let n = 2; y0 / n > 1 && y0 / n > yBottom; n++) {
              p.strokeWeight(3 * (this.twoDivs(n) + 1) / Math.log2(n));
              p.stroke((256*Math.log2(n)) % 256, 128, 196);
              p.line(0, viewport.mapY(y0 / n, p), p.width, viewport.mapY(y0 / n, p));
            }
        }
    }

    twoDivs(n: number): number {
        let r = 0;
        n = Math.floor(n);
        while (n % 2 == 0) {
            r++;
            n = Math.floor(n / 2);
        }
        return r;
    }
}
