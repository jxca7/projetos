// Recebe a tarefa escolhida no menu do rodar.bat e chama o arquivo certo.
const tarefas = {
  perfil: './perfil',
  conectar: './conectar',
  testar: './testar',
};

const tarefa = process.argv[2];
const mod = tarefas[tarefa];
if (!mod) {
  console.error(`Tarefa desconhecida: "${tarefa}". Use perfil, conectar ou testar.`);
  process.exit(1);
}

require(mod)
  .rodar()
  .catch((err) => {
    console.error('\nERRO:', err.message);
    process.exitCode = 1;
  });
