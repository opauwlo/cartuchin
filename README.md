# Cartuchin

Emulador de Game Boy Advance (e Game Boy / Color) que roda no navegador, com a ROM e o save guardados num repositório **privado** do GitHub. Jogue no celular, continue no tablet ou na TV.

**Abrir:** https://opauwlo.github.io/cartuchin/

## Como funciona

- O emulador é o [mGBA](https://mgba.io) compilado para WebAssembly, rodando pelo [EmulatorJS](https://github.com/EmulatorJS/EmulatorJS).
- Este repositório é público e só tem o site. Nada de ROM ou save aqui.
- Com **Entrar com Google**, as ROMs e os saves vão para a pasta oculta do app no Google Drive de cada pessoa (escopo `drive.appdata`: o app não enxerga nenhum outro arquivo). Opção avançada: um repositório privado do GitHub, pela API, com um token que só tem acesso a ele:
  - `cartucho.json`: a biblioteca
  - `roms/<jogo>.gz`: a ROM compactada
  - `saves/<jogo>.json`: o save atual e o anterior
  - Cada save vira um commit, então o histórico do repositório também é um backup.
- O save sobe a cada 15 segundos quando muda, e quando você sai do jogo ou troca de aba.

## Conectar

1. Crie o repositório privado `cartuchin-dados` (com um README).
2. Gere um token fine-grained em https://github.com/settings/personal-access-tokens/new, só com acesso ao `cartuchin-dados` e permissão **Contents: Read and write**.
3. Abra o site e cole o token.

Outros aparelhos (TV, tablet) se conectam sem digitar o token: toque em "Conectar com outro aparelho", escaneie o QR com o celular já conectado e confirme. O token viaja criptografado (AES-GCM, chave derivada do código de 8 letras que só aparece nas duas telas) por um tópico descartável do [ntfy.sh](https://ntfy.sh).

## Notas

- ROM hacks de Pokémon que usam um código de jogo próprio recebem o chip de save certo (flash de 128 KB e relógio). Sem isso, vários travam na tela branca.
- Save states do menu do emulador ficam só no aparelho. O que sincroniza é o save feito dentro do jogo.
- Licenças: EmulatorJS (GPL-3.0), mGBA (MPL-2.0), qrcode-generator (MIT). Veja a pasta `vendor/`.
