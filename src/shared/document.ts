import { reactive } from "vue";
import type { StageDocument } from "./types";
import { defaultEntrance } from "./types";

export function createDocument(): StageDocument {
  return reactive({
    scenes: [
      {
        id: "s1",
        name: "Celestial orbit",
        kind: "orbit",
        theme: "violet",
        intensity: 0.8,
        speed: 1,
        entrance: {
          ...defaultEntrance(),
          mode: "expand",
          duration: 2,
          unit: "beats",
        },
      },
      {
        id: "s2",
        name: "Frequency field",
        kind: "spectrum",
        theme: "mint",
        intensity: 0.75,
        speed: 1,
        entrance: {
          ...defaultEntrance(),
          mode: "wipe",
          direction: "left",
          duration: 0.8,
          unit: "seconds",
        },
      },
      {
        id: "s3",
        name: "Liquid signal",
        kind: "wave",
        theme: "ember",
        intensity: 0.7,
        speed: 0.6,
        entrance: {
          ...defaultEntrance(),
          mode: "reveal",
          shape: "diamond",
          duration: 1,
          unit: "beats",
        },
      },
      {
        id: "s4",
        name: "Into the void",
        kind: "tunnel",
        theme: "ice",
        intensity: 0.9,
        speed: 1.2,
        entrance: {
          ...defaultEntrance(),
          mode: "fade",
          duration: 1.6,
          unit: "seconds",
        },
      },
    ],
    activeId: "s1",
    gain: 0.65,
    sensitivity: 1.2,
    smoothing: 0.78,
    blackout: false,
    frozen: false,
    strobe: false,
    master: 1,
  });
}
