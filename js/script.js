const estadoPython = document.getElementById("estado-python");
const entradaLista = document.getElementById("lista-inicial");
const entradaCodigo = document.getElementById("codigo");

const botonCrear = document.getElementById("crear-lista");
const botonEjecutar = document.getElementById("ejecutar");
const botonReiniciar = document.getElementById("reiniciar");
const botonAnterior = document.getElementById("anterior");
const botonSiguiente = document.getElementById("siguiente");

const visualizacionLista = document.getElementById("visualizacion-lista");
const resultado = document.getElementById("resultado");
const historial = document.getElementById("historial");

let pyodide;
let pasos = [];
let pasoActual = 0;
let listaInicial;
let ejecutando = false;

const botones = [
    botonCrear,
    botonEjecutar,
    botonReiniciar,
    botonAnterior,
    botonSiguiente
];

function bloquearBotones(bloquear) {
    botones.forEach(boton => {
        boton.disabled = bloquear;
    });
}

// Inicializar Python en el navegador.
async function iniciarPython() {
    bloquearBotones(true);

    try {
        pyodide = await loadPyodide();

        await pyodide.runPythonAsync(`
import ast
import contextlib
import copy
import io
import json
import traceback

# Entorno de Python para trabajar con listas.
__entorno = {
    "__builtins__": {
        "abs": abs,
        "all": all,
        "any": any,
        "bool": bool,
        "dict": dict,
        "enumerate": enumerate,
        "filter": filter,
        "float": float,
        "int": int,
        "len": len,
        "list": list,
        "map": map,
        "max": max,
        "min": min,
        "print": print,
        "range": range,
        "reversed": reversed,
        "round": round,
        "set": set,
        "sorted": sorted,
        "str": str,
        "sum": sum,
        "tuple": tuple,
        "type": type,
        "zip": zip
    }
}

def _representar_lista():
    return [repr(elemento) for elemento in __entorno["lista"]]

def _crear_lista(texto):
    global __historial_python

    nueva_lista = ast.literal_eval(texto)

    if not isinstance(nueva_lista, list):
        raise ValueError("Debes introducir una lista de Python.")

    __entorno["lista"] = nueva_lista

    __historial_python = [
        copy.deepcopy(nueva_lista)
    ]

    return json.dumps(_representar_lista())

def _restaurar_lista(indice):
    __entorno["lista"] = copy.deepcopy(
        __historial_python[indice]
    )

    return json.dumps(_representar_lista())

def _cortar_historial(indice):
    global __historial_python

    __historial_python = __historial_python[:indice + 1]

def _ejecutar_codigo(codigo):
    salida = io.StringIO()
    valor_devuelto = None
    hubo_expresion = False
    error = None

    try:
        arbol = ast.parse(codigo)

        # Ejecutar las instrucciones anteriores a la última.
        instrucciones = arbol.body

        if instrucciones:
            ultima = instrucciones[-1]

            if isinstance(ultima, ast.Expr):
                anteriores = ast.Module(
                    body=instrucciones[:-1],
                    type_ignores=[]
                )

                if anteriores.body:
                    exec(
                        compile(anteriores, "<clase>", "exec"),
                        __entorno,
                        __entorno
                    )

                expresion = ast.Expression(
                    body=ultima.value
                )

                valor_devuelto = eval(
                    compile(expresion, "<clase>", "eval"),
                    __entorno,
                    __entorno
                )

                hubo_expresion = True

            else:
                exec(
                    compile(arbol, "<clase>", "exec"),
                    __entorno,
                    __entorno
                )

        else:
            raise ValueError("Escribe una instrucción de Python.")

    except Exception as excepcion:
        error = f"{type(excepcion).__name__}: {excepcion}"

    # Obtener la salida de print().
    # Se captura durante la ejecución para evitar mezclarla con
    # la salida de otras instrucciones.
    return json.dumps({
        "lista": _representar_lista(),
        "salida": salida.getvalue(),
        "valor": (
            repr(valor_devuelto)
            if hubo_expresion
            else None
        ),
        "hubo_expresion": hubo_expresion,
        "error": error
    })

def _ejecutar_con_salida(codigo):
    salida = io.StringIO()

    try:
        with contextlib.redirect_stdout(salida):
            respuesta = json.loads(_ejecutar_codigo(codigo))

        respuesta["salida"] = salida.getvalue()

    except Exception as excepcion:
        respuesta = {
            "lista": _representar_lista(),
            "salida": salida.getvalue(),
            "valor": None,
            "hubo_expresion": False,
            "error": f"{type(excepcion).__name__}: {excepcion}"
        }

    return json.dumps(respuesta)
        `);

        estadoPython.textContent = "Python está listo.";
        estadoPython.style.color = "#9cf2b2";

        bloquearBotones(false);

        await crearLista();

    } catch (error) {
        estadoPython.textContent = "No se pudo cargar Python.";
        estadoPython.style.color = "#ffaaaa";

        resultado.textContent =
            "Error al iniciar Pyodide: " + error.message;

        console.error(error);
    }
}

// Ejecutar una función de Python y convertir su resultado JSON.
async function llamarPython(funcion, argumento) {
    pyodide.globals.set("_argumento_js", argumento);

    try {
        const respuesta = await pyodide.runPythonAsync(
            `${funcion}(_argumento_js)`
        );

        return JSON.parse(respuesta);

    } finally {
        pyodide.globals.delete("_argumento_js");
    }
}

// Crear o reemplazar la lista inicial.
async function crearLista() {
    if (ejecutando) return;

    ejecutando = true;
    bloquearBotones(true);

    try {
        const nuevaLista = await llamarPython(
            "_crear_lista",
            entradaLista.value
        );

        listaInicial = [...nuevaLista];

        pasos = [{
            codigo: "Lista inicial",
            lista: [...nuevaLista],
            anterior: null,
            salida: "",
            valor: null,
            error: null
        }];

        pasoActual = 0;

        resultado.replaceChildren();

        agregarParrafo(
            resultado,
            "Lista creada correctamente."
        );

        agregarParrafo(
            resultado,
            "Elementos: " + nuevaLista.length
        );

        renderizarTodo();

    } catch (error) {
        mostrarError(error.message);
    } finally {
        ejecutando = false;
        bloquearBotones(false);
        actualizarBotonesHistorial();
    }
}

// Ejecutar las instrucciones escritas por el estudiante.
async function ejecutarCodigo() {
    if (ejecutando || !pyodide) return;

    const codigo = entradaCodigo.value.trim();

    if (!codigo) {
        mostrarError("Escribe una instrucción antes de ejecutar.");
        return;
    }

    ejecutando = true;
    bloquearBotones(true);

    try {
        // Si retrocedimos en el historial, descartamos los pasos futuros.
        if (pasoActual < pasos.length - 1) {
            await llamarPython(
                "_cortar_historial",
                pasoActual
            );

            pasos = pasos.slice(0, pasoActual + 1);
        }

        const anterior = [...pasos[pasoActual].lista];

        pyodide.globals.set("_codigo_js", codigo);

        let respuesta;

        try {
            const json = await pyodide.runPythonAsync(
                "_ejecutar_con_salida(_codigo_js)"
            );

            respuesta = JSON.parse(json);

        } finally {
            pyodide.globals.delete("_codigo_js");
        }

        const nuevoPaso = {
            codigo,
            lista: [...respuesta.lista],
            anterior,
            salida: respuesta.salida,
            valor: respuesta.valor,
            error: respuesta.error
        };

        pasos.push(nuevoPaso);
        pasoActual = pasos.length - 1;

        renderizarTodo();

    } catch (error) {
        mostrarError(error.message);
    } finally {
        ejecutando = false;
        bloquearBotones(false);
        actualizarBotonesHistorial();
    }
}

// Mostrar la lista y sus índices.
function renderizarLista(actual, anterior = null) {
    visualizacionLista.replaceChildren();

    if (actual.length === 0) {
        agregarParrafo(
            visualizacionLista,
            "La lista está vacía."
        );

        return;
    }

    actual.forEach((valor, indice) => {
        const tarjeta = document.createElement("div");
        tarjeta.className = "elemento-lista";

        const etiquetaIndice = document.createElement("span");
        etiquetaIndice.className = "indice";
        etiquetaIndice.textContent = `Índice ${indice}`;

        const etiquetaValor = document.createElement("span");
        etiquetaValor.className = "valor";
        etiquetaValor.textContent = valor;

        tarjeta.append(etiquetaIndice, etiquetaValor);

        if (anterior !== null) {
            const antes = contarValor(anterior, valor);
            const despues = contarValor(actual, valor);

            if (despues > antes) {
                tarjeta.classList.add("agregado");

            } else if (
                actual.length === anterior.length &&
                actual[indice] !== anterior[indice]
            ) {
                tarjeta.classList.add("modificado");
            }
        }

        visualizacionLista.appendChild(tarjeta);
    });
}

// Contar apariciones de un elemento representado como texto.
function contarValor(lista, valor) {
    return lista.filter(elemento => elemento === valor).length;
}

// Mostrar la explicación y el resultado de la instrucción.
function renderizarResultado(paso) {
    resultado.replaceChildren();

    const titulo = document.createElement("h3");
    titulo.textContent = paso.codigo;

    resultado.appendChild(titulo);

    if (paso.error) {
        const mensaje = document.createElement("p");
        mensaje.textContent = "Error: " + paso.error;
        mensaje.style.color = "#c62828";

        resultado.appendChild(mensaje);

    } else {
        if (paso.salida) {
            agregarParrafo(
                resultado,
                "Salida de print(): " + paso.salida.trimEnd()
            );
        }

        if (paso.valor !== null) {
            agregarParrafo(
                resultado,
                "Valor devuelto: " + paso.valor
            );
        }

        const cambios = compararListas(
            paso.anterior,
            paso.lista
        );

        agregarParrafo(
            resultado,
            cambios.length
                ? "Cambios detectados: " + cambios.join("; ")
                : "La lista no cambió."
        );
    }

    agregarParrafo(
        resultado,
        "Lista actual: [" + paso.lista.join(", ") + "]"
    );
}

// Detectar cambios entre dos listas representadas como texto.
function compararListas(anterior, actual) {
    if (anterior === null) return [];

    const cambios = [];

    const restantes = [...anterior];

    actual.forEach((valor, indice) => {
        const posicion = restantes.indexOf(valor);

        if (posicion !== -1) {
            restantes.splice(posicion, 1);
        } else {
            cambios.push(
                `se añadió ${valor} (posición ${indice})`
            );
        }
    });

    restantes.forEach(valor => {
        cambios.push(`se eliminó ${valor}`);
    });

    if (
        cambios.length === 0 &&
        anterior.length === actual.length
    ) {
        anterior.forEach((valor, indice) => {
            if (valor !== actual[indice]) {
                cambios.push(
                    `se modificó el elemento del índice ${indice}`
                );
            }
        });
    }

    return cambios;
}

// Dibujar el historial completo.
function renderizarHistorial() {
    historial.replaceChildren();

    pasos.forEach((paso, indice) => {
        const tarjeta = document.createElement("div");
        tarjeta.className = "paso-historial";

        const titulo = document.createElement("strong");

        titulo.textContent =
            `${indice}. ${paso.codigo}`;

        const contenido = document.createElement("p");

        contenido.textContent =
            "[" + paso.lista.join(", ") + "]";

        if (indice === pasoActual) {
            tarjeta.style.borderLeftColor = "#29965d";
            tarjeta.style.backgroundColor = "#e0f8e9";
        }

        tarjeta.append(titulo, contenido);

        historial.appendChild(tarjeta);
    });
}

// Actualizar la pantalla según el paso seleccionado.
function renderizarTodo() {
    const paso = pasos[pasoActual];

    if (!paso) return;

    renderizarLista(
        paso.lista,
        paso.anterior
    );

    renderizarResultado(paso);
    renderizarHistorial();

    actualizarBotonesHistorial();
}

function actualizarBotonesHistorial() {
    botonAnterior.disabled =
        ejecutando || pasoActual <= 0;

    botonSiguiente.disabled =
        ejecutando || pasoActual >= pasos.length - 1;
}

// Retroceder un paso y restaurar la lista real de Python.
async function irAnterior() {
    if (ejecutando || pasoActual <= 0) return;

    ejecutando = true;
    bloquearBotones(true);

    try {
        pasoActual--;

        const lista = await llamarPython(
            "_restaurar_lista",
            pasoActual
        );

        pasos[pasoActual].lista = [...lista];

        renderizarTodo();

    } catch (error) {
        mostrarError(error.message);
    } finally {
        ejecutando = false;
        bloquearBotones(false);
        actualizarBotonesHistorial();
    }
}

// Avanzar un paso y restaurar la lista real de Python.
async function irSiguiente() {
    if (
        ejecutando ||
        pasoActual >= pasos.length - 1
    ) return;

    ejecutando = true;
    bloquearBotones(true);

    try {
        pasoActual++;

        const lista = await llamarPython(
            "_restaurar_lista",
            pasoActual
        );

        pasos[pasoActual].lista = [...lista];

        renderizarTodo();

    } catch (error) {
        mostrarError(error.message);
    } finally {
        ejecutando = false;
        bloquearBotones(false);
        actualizarBotonesHistorial();
    }
}

// Reiniciar a la lista original.
async function reiniciar() {
    if (ejecutando || !listaInicial) return;

    entradaLista.value =
        "[" + listaInicial.join(", ") + "]";

    await crearLista();
}

function agregarParrafo(contenedor, texto) {
    const parrafo = document.createElement("p");
    parrafo.textContent = texto;

    contenedor.appendChild(parrafo);
}

function mostrarError(mensaje) {
    resultado.replaceChildren();

    const parrafo = document.createElement("p");
    parrafo.textContent = mensaje;
    parrafo.style.color = "#c62828";

    resultado.appendChild(parrafo);
}

// Conectar los botones con sus funciones.
botonCrear.addEventListener("click", crearLista);
botonEjecutar.addEventListener("click", ejecutarCodigo);
botonReiniciar.addEventListener("click", reiniciar);
botonAnterior.addEventListener("click", irAnterior);
botonSiguiente.addEventListener("click", irSiguiente);

// Arrancar la aplicación.
iniciarPython();