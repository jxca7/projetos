// Recebe a tarefa escolhida no menu do rodar.bat e chama o arquivo certo.
// Garante que as pastas e os arquivos-modelo existam (caso rode sem passar pelo rodar.bat)
require('./preparar').preparar();

// cada tarefa: [arquivo, função a chamar]
const tarefas = {
  tudo: ['./tudo', 'rodar'],
  perfil: ['./perfil', 'rodar'],
  conectar: ['./conectar', 'rodar'],
  conectar_testador: ['./conectar', 'rodarComTestador'],
  testar: ['./testar', 'rodar'],
  capturar: ['./capturar_site', 'rodar'],
  testadores: ['./testadores', 'rodar'],
};

const tarefa = process.argv[2];
const def = tarefas[tarefa];
if (!def) {
  console.error(`Tarefa desconhecida: "${tarefa}". Use: ${Object.keys(tarefas).join(', ')}.`);
  process.exit(1);
}

const [mod, fn] = def;
require(mod)
  [fn]()
  .catch((err) => {
    console.error('\nERRO:', err.message);
    process.exitCode = 1;
  });
