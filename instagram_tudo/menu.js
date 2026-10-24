// Recebe a tarefa escolhida no menu do rodar.bat e chama o arquivo certo.
// Garante que as pastas e os arquivos-modelo existam (caso rode sem passar pelo rodar.bat)
require('./preparar').preparar();

const tarefas = {
  tudo: './tudo',
  perfil: './perfil',
  conectar: './conectar',
  testar: './testar',
  capturar: './capturar_site',
};

const tarefa = process.argv[2];
const mod = tarefas[tarefa];
if (!mod) {
  console.error(`Tarefa desconhecida: "${tarefa}". Use tudo, perfil, conectar ou testar.`);
  process.exit(1);
}

require(mod)
  .rodar()
  .catch((err) => {
    console.error('\nERRO:', err.message);
    process.exitCode = 1;
  });
