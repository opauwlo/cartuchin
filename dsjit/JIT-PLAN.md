# JIT de ARM para WebAssembly no melonDS (Cartuchin)

Objetivo: Pokémon Black/White a 100% no Motorola Edge 70 Fusion+ pelo navegador.

## Medida de partida (celular do Uwlo, build própria, medidor por amostragem)
- Quadro: 18,7 ms (precisa 16,7). Máximo 89% (LTO: 91%).
- ARM9 interpretado: 70% (13 ms). ARM7: 10%. 2D: 9%. Resto < 3% cada.
- Conta: ARM9 1,5x mais rápido → ~14 ms (~115%); 2x → ~12 ms (~135%).

## Arquitetura
- O melonDS já tem o frontend do JIT (ARMJIT.cpp): decodifica blocos, cache de blocos,
  invalidação quando o jogo escreve na memória de código, detecção de loop ocioso.
  Backends existentes: x64 e ARM64. Falta um backend WASM.
- Ponteiro de função no wasm = índice na tabela de funções. O backend gera um módulo
  wasm pequeno por bloco (função void()), que importa a memória e a tabela do módulo
  principal; o JS instancia e põe a função na tabela (table.grow + table.set). O índice
  vira o JitBlockEntry: o C chama com call_indirect, sem cola extra.
- ARM_Dispatch (hoje em assembly) vira C: entry().
- Fastmem (mmap/mprotect/sinais) não existe no wasm: JIT_FastMemory = false e
  ARMJIT_Memory sem os caminhos de mmap.
- Compilação síncrona de wasm na thread principal do Chrome é limitada a 4 KB por
  módulo: blocos maiores ficam no interpretador (ou o emulador vai pra um worker).

## Fases (cada uma medida no celular antes da próxima)
- A. "Call-threaded": o bloco gerado chama a função do interpretador de cada instrução
  com R15/CurInstr/CodeCycles já constantes. Tira busca, decodificação e despacho por
  instrução; ganha a detecção de loop ocioso. Sem otimizações de ramo/literal.
- B. Instruções quentes em wasm direto: ALU, ramos, load/store com caminho rápido.
- C. Cache de registradores em locais do wasm; ARM7 também.

## Regras de trabalho
- Script de build: /home/claude/dsjit/build-core.sh (set -euo pipefail, artefatos conferidos).
- Toda edição por script confere a contagem de ocorrências.
- Testar com a ROM mínima aqui; a medida que vale é a do celular.
