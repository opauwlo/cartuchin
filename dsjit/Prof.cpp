#include "Prof.h"
#ifdef CARTUCHIN_PROF
#include <stdio.h>
#include <pthread.h>
#include <atomic>
namespace Prof {
volatile int Cur = OUTSIDE;
unsigned Calls[COUNT];
static std::atomic<unsigned> Hist[COUNT];
static std::atomic<unsigned> Samples{0};
static bool started = false;
static int frames = 0;
static double since = 0;

// the sampler: a busy loop on its own thread (the phone has cores to spare for a test)
static void* sampler(void*) {
    double next = emscripten_get_now();
    for (;;) {
        while (emscripten_get_now() < next) {}
        next += 0.05;   // 50 µs
        int c = Cur;
        if (c >= 0 && c < COUNT) Hist[c]++;
        Samples++;
    }
    return nullptr;
}

void EndFrame() {
    if (!started) {
        started = true;
        pthread_t t;
        if (pthread_create(&t, nullptr, sampler, nullptr) != 0)
            emscripten_run_script("window.__dsProf={error:'sem thread para o medidor'}");
        since = emscripten_get_now();
    }
    if (++frames < 60) return;
    double now = emscripten_get_now(), wall = (now - since) / frames;   // ms per frame, real time
    unsigned n = Samples.exchange(0);
    double h[COUNT];
    for (int i = 0; i < COUNT; i++) h[i] = n ? (double)Hist[i].exchange(0) / n : 0;
    char js[1200];
    snprintf(js, sizeof js,
        "window.__dsProf={sampled:1,wall:%.3f,samples:%u,outside:%.4f,frame:%.4f,arm9:%.4f,arm7:%.4f,geometry:%.4f,system:%.4f,"
        "raster3d:%.4f,draw2d:%.4f,dma:%.4f,timers:%.4f,video:%.4f,videocb:%.4f,audio:%.4f,input:%.4f,vars:%.4f,spu:%.4f,"
        "jitcompile:%.4f,jitrun9:%.4f,jitrun7:%.4f,arm9calls:%.0f,arm7calls:%.0f,at:performance.now()}",
        wall, n, h[OUTSIDE], h[FRAME], h[ARM9], h[ARM7], h[GEOMETRY], h[SYSTEM], h[RASTER3D], h[DRAW2D], h[DMA], h[TIMERS],
        h[VIDEO], h[VIDEOCB], h[AUDIO], h[INPUT], h[VARS], h[SPU], h[JITCOMPILE], h[JITRUN9], h[JITRUN7],
        (double)Calls[ARM9] / frames, (double)Calls[ARM7] / frames);
    emscripten_run_script(js);
    for (int i = 0; i < COUNT; i++) Calls[i] = 0;
    frames = 0; since = now;
}
}
#endif
