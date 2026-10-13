/*
    WebAssembly backend for the melonDS JIT (Cartuchin). Phase A: "threaded blocks".

    A block is not turned into machine code: it becomes a list of pre-decoded steps,
    each one the interpreter handler of an instruction with its operands, pipeline PC
    and code cycles already known. Running a block walks that list, so the fetch and
    decode of every instruction (the interpreter's per-instruction work) is gone, and
    the frontend's block-level tricks (idle loop detection, following branches) apply.

    JitBlockEntry is a function pointer on other backends. Here it carries the index of
    the block's descriptor (never dereferenced as a pointer): ARM_Dispatch, which is ours,
    reads it back. Later phases replace the step list with generated WebAssembly.
*/
#ifndef ARMJIT_WASM_COMPILER_H
#define ARMJIT_WASM_COMPILER_H

#include "../ARMJIT.h"
#include "../ARMJIT_Internal.h"
#include <vector>
#include <stdint.h>

namespace ARMJIT
{

struct ThreadedStep
{
    InterpreterFunc Func;   // the interpreter handler of this instruction
    u32 Instr;              // the instruction word (handlers decode operands from it)
    u32 R15;                // pipeline PC as the interpreter sees it: address + 8 (ARM) / + 4 (THUMB)
    u16 CodeCycles;
    u8 Cond;                // ARM condition; 0xE for THUMB (handlers check their own)
    u8 Kind;                // what to do: see StepKind in the .cpp
    u8 BranchFlags;
};

struct ThreadedBlock
{
    u32 FirstStep, NumSteps;
    bool Thumb;
};

class Compiler
{
public:
    Compiler();

    void Reset();
    JitBlockEntry CompileBlock(ARM* cpu, bool thumb, FetchedInstr instrs[], int instrsCount, bool hasMemoryInstr);
    bool CanCompile(bool thumb, u16 kind) { return false; }   // no native code for any instruction yet

    JitBlockEntry AddEntryOffset(u32 offset) { return (JitBlockEntry)(uintptr_t)offset; }
    u32 SubEntryOffset(JitBlockEntry entry) { return (u32)(uintptr_t)entry; }

    // there is no fastmem on the web, so the JIT never faults
    bool IsJITFault(u8* pc) { return false; }
    u8* RewriteMemAccess(u8* pc) { return pc; }

    std::vector<ThreadedStep> Steps;
    std::vector<ThreadedBlock> Blocks;   // index 0 is unused: entry 0 means "no block"
};

}

#endif
