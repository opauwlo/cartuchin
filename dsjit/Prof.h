// Cartuchin profiler: where does a DS frame's time go in the browser?
//
// Sampling, not timing: melonDS splits each frame into ~9000 CPU slices of ~1 µs, below
// the browser clock's 5 µs resolution, so timing each slice measures nothing. Instead,
// the emulator only writes "now I'm in part X" into a global (one store), and a separate
// thread reads it every ~50 µs and counts. The share of samples is the share of time.
// Needs a threaded build (shared memory). Published to JavaScript as window.__dsProf.
#pragma once
#ifndef CARTUCHIN_NO_PROF   // builds for playing pass -DCARTUCHIN_NO_PROF
#define CARTUCHIN_PROF 1
#endif
#ifdef CARTUCHIN_PROF
// declared here instead of including emscripten.h, which clashes with libretro's FILE remap
extern "C" double emscripten_get_now(void);
extern "C" void emscripten_run_script(const char* script);
namespace Prof {
// OUTSIDE = not inside retro_run: RetroArch's own loop and the browser
enum Part { OUTSIDE = 0, FRAME, ARM9, ARM7, GEOMETRY, SYSTEM, RASTER3D, DRAW2D, DMA, TIMERS,
            VIDEO, VIDEOCB, AUDIO, INPUT, VARS, SPU,
            JITCOMPILE, JITRUN9, JITRUN7, COUNT };   // JIT: building a block, running a block (per CPU)
extern volatile int Cur;
extern unsigned Calls[COUNT];
struct Mark {
    int prev;
    Mark(int part) : prev(Cur) { Cur = part; Calls[part]++; }
    ~Mark() { Cur = prev; }
};
void EndFrame();   // called once per retro_run; starts the sampler, publishes once a second
}
#define PROF(part) Prof::Mark _prof_##__LINE__(Prof::part)
#define PROF_SAMPLED(part) PROF(part)
#else
#define PROF(part)
#define PROF_SAMPLED(part)
#endif
