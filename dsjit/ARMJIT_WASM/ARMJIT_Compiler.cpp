#include "../ARMJIT_Compiler.h"   // this backend's class, plus the global JITCompiler

#include "../ARM.h"
#include "../ARMInterpreter.h"
#include "../ARMInterpreter_Branch.h"
#include "../ARM_InstrInfo.h"
#include <stdio.h>
#include "../Prof.h"

// declared here instead of including emscripten.h, which clashes with libretro's FILE remap
extern "C" void emscripten_run_script(const char* script);

namespace ARMJIT
{

enum StepKind : u8
{
    step_Interpret,     // run the handler (after the condition check for ARM)
    step_BLXImm,        // ARM BLX <imm>: its condition field is 0xF, it always runs
    step_CondNever,     // other ARM instructions with condition 0xF: only spend the cycles
    step_ThumbBLLong,   // THUMB BL/BLX: the frontend merged its two halves into one word
};

/* The frontend merges a THUMB BL/BLX pair into one instruction, with the first half in
   the low 16 bits and the second in the high 16 bits. Native backends compile it
   whole; the interpreter's halves each decode their own half, so run them in turn. */
static void ThumbBLLong(ARM* cpu, u32 merged)
{
    cpu->CurInstr = merged & 0xFFFF;
    ARMInterpreter::T_BL_LONG_1(cpu);
    cpu->R[15] += 2;
    cpu->CurInstr = merged >> 16;
    ARMInterpreter::T_BL_LONG_2(cpu);
}

Compiler::Compiler()
{
    Reset();
}

void Compiler::Reset()
{
    Steps.clear();
    Blocks.clear();
    Blocks.push_back({0, 0, false});
}

JitBlockEntry Compiler::CompileBlock(ARM* cpu, bool thumb, FetchedInstr instrs[], int instrsCount, bool hasMemoryInstr)
{
    ThreadedBlock block{(u32)Steps.size(), (u32)instrsCount, thumb};
    for (int i = 0; i < instrsCount; i++)
    {
        const FetchedInstr& in = instrs[i];
        ThreadedStep s;
        s.Instr = in.Instr;
        s.R15 = in.Addr + (thumb ? 4 : 8);
        s.CodeCycles = in.CodeCycles;
        s.BranchFlags = in.BranchFlags;
        if (thumb)
        {
            s.Func = InterpretTHUMB[in.Info.Kind];
            s.Cond = 0xE;
            s.Kind = in.Info.Kind == ARMInstrInfo::tk_BL_LONG ? step_ThumbBLLong : step_Interpret;
        }
        else
        {
            s.Func = InterpretARM[in.Info.Kind];
            s.Cond = in.Cond();
            if (in.Info.Kind == ARMInstrInfo::ak_BLX_IMM)
                s.Kind = step_BLXImm;
            else if (s.Cond == 0xF)
                s.Kind = step_CondNever;
            else
                s.Kind = step_Interpret;
        }
        Steps.push_back(s);
    }
    Blocks.push_back(block);
    // let the page see that the JIT is on and how much it compiled (every 256 blocks)
    if ((Blocks.size() & 255) == 0)
    {
        char js[96];
        snprintf(js, sizeof js, "window.__jit={blocks:%u,steps:%u}", (u32)Blocks.size() - 1, (u32)Steps.size());
        emscripten_run_script(js);
    }
    return AddEntryOffset((u32)(Blocks.size() - 1));
}

}

using namespace ARMJIT;

/* Runs one block. Mirrors what the x64 backend emits for instructions it hands to the
   interpreter: set R[15], CurInstr and CodeCycles, check the condition, call the handler
   (which adds its own cycles), and leave early when a followed branch went the other way. */
extern "C" void ARM_Dispatch(ARM* cpu, JitBlockEntry entry)
{
#ifdef CARTUCHIN_PROF
    Prof::Mark _prof(cpu->Num == 0 ? Prof::JITRUN9 : Prof::JITRUN7);
#endif
    Compiler* c = JITCompiler;
    const ThreadedBlock& block = c->Blocks[(u32)(uintptr_t)entry];
    const ThreadedStep* s = c->Steps.data() + block.FirstStep;
    const ThreadedStep* end = s + block.NumSteps;

    for (; s < end; s++)
    {
        cpu->R[15] = s->R15;
        cpu->CurInstr = s->Instr;
        cpu->CodeCycles = s->CodeCycles;

        // Branch flags are only set on static conditional branches (B/BL with a condition,
        // THUMB B<cond>), whose "taken" is exactly "condition passed". Comparing the PC
        // before and after would fail for a branch to itself (common in wait loops).
        bool condPassed = true;
        if (s->BranchFlags && block.Thumb)
            condPassed = cpu->CheckCondition((s->Instr >> 8) & 0xF);

        bool executed = true;
        switch (s->Kind)
        {
        case step_Interpret:
            if (s->Cond < 0xE && !cpu->CheckCondition(s->Cond))
            {
                cpu->AddCycles_C();
                executed = false;
            }
            else
                s->Func(cpu);
            break;
        case step_BLXImm:
            ARMInterpreter::A_BLX_IMM(cpu);
            break;
        case step_CondNever:
            cpu->AddCycles_C();
            executed = false;
            break;
        case step_ThumbBLLong:
            ThumbBLLong(cpu, s->Instr);
            break;
        }

        if (s->BranchFlags)
        {
            bool taken = block.Thumb ? condPassed : executed;
            if (taken && (s->BranchFlags & branch_IdleBranch))
                cpu->IdleLoop |= 1;
            if ((s->BranchFlags & branch_FollowCondNotTaken) && taken)
                return;
            if ((s->BranchFlags & branch_FollowCondTaken) && !taken)
                return;
        }
    }
}
