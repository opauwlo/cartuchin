/* the few library calls the compiler may emit */
typedef unsigned int u32;
void* memcpy(void* d, const void* s, unsigned n) { unsigned char* a = d; const unsigned char* b = s; while (n--) *a++ = *b++; return d; }
void* memset(void* d, int c, unsigned n) { unsigned char* a = d; while (n--) *a++ = (unsigned char)c; return d; }
void __aeabi_memcpy(void* d, const void* s, unsigned n) { memcpy(d, s, n); }
void __aeabi_memcpy4(void* d, const void* s, unsigned n) { memcpy(d, s, n); }
void __aeabi_memclr(void* d, unsigned n) { memset(d, 0, n); }
void __aeabi_memclr4(void* d, unsigned n) { memset(d, 0, n); }
