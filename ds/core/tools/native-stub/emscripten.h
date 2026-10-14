// Stub só para o teste nativo (NATIVE_CHECK=1). Não é usado no build wasm.
#pragma once
#include <sys/time.h>
#define EMSCRIPTEN_KEEPALIVE
#define EM_ASM(...) ((void)0)
#define EM_ASM_INT(...) 8
#define EM_JS(ret, name, params, ...) ret name params { return 0; }
static inline double emscripten_get_now(void){struct timeval t;gettimeofday(&t,0);return t.tv_sec*1000.0+t.tv_usec/1000.0;}
