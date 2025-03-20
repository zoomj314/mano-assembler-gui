// Get html elements
var uploadBtn = document.getElementById("fileBtn");
var SymbolTableOut = document.getElementById("symbolTableOut");
var memoryOut = document.getElementById("memoryOut");
var downloadBtn = document.getElementById("downloadBtn");
var downloadAssemblyBtn = document.getElementById("downloadAssemblyBtn");
var filenameIn = document.getElementById("filenameIn");
var logOut = document.getElementById("logOut");
var assemblerLogStatus = document.getElementById("assemblerLogStatus");
var memoryOutStatus = document.getElementById("memoryOutStatus");
var editor = ace.edit("editor");

const STATUSES = {
    STATUS_GOOD: {char: "\u2713", class: "status-good"},
    STATUS_WARNING: {char: "!", class: "status-warning"},
    STATUS_ERROR: {char: "\u26A0", class: "status-err"},
}

var projectName = "untitled";
var unsavedChanges = false;

uploadBtn.addEventListener('change', parseFile);
filenameIn.addEventListener('keypress', (e) => setTimeout(rename, 10, e));
filenameIn.addEventListener('change', rename);
downloadAssemblyBtn.addEventListener("click", onDownloadBtnClick);
addEventListener("beforeunload", onLeave);
editor.session.on('change', onAssemblyChange);
editor.session.selection.on('changeCursor', onEditorCursorChange);

// This function is run when a file is selected by the user. It opens the file then if there are no issues starts the assembly process
function parseFile(e) {;
    if (unsavedChanges) {
        var confirmed = confirm("You have unsaved changes, are you sure you want to load a new file?");
        console.log(confirmed);
        if (!confirmed) {
            return
        }
    }
    var file = e.target.files[0]

    // Some basic checks
    if (!file) {
        console.error("No file opened")
        return
    }
    projectName = file.name.slice(0, file.name.indexOf("."));
    filenameIn.value = projectName;

    var reader = new FileReader();
    reader.onload = () => {
        editor.session.setValue(reader.result, -1);
        assemble(reader.result);
    };
    reader.onerror = () => {
        alert("Error reading the file.");
    };
    reader.readAsText(file);
    uploadBtn.value = ""
}

// This function handles the assembly process
function assemble(assembly) {
    clearLogs();
    
    // Split the string into a list of lines
    var lines = assembly.split(/\r?\n/g);

    // Remove comments and extra whitespace
    for(var i = 0; i < lines.length; i++) {
        if (lines[i].indexOf("/") != -1) {
            lines[i] = lines[i].substring(0, lines[i].indexOf("/"))
        }
        lines[i] = lines[i].trim();
    }

    // Reset logs and statuses, and assemble
    setStatus(memoryOutStatus, STATUSES.STATUS_GOOD, true);
    setStatus(assemblerLogStatus, STATUSES.STATUS_GOOD, true);

    log("Generating symbol table");

    // symbolData contains a symbol table and a map of which line in the source file each symbol is defined at
    var symbolData = generateSymbolTable(lines);
    var symbolTable = symbolData[0];
    var symbolLineNums = symbolData[1];

    log("Generating memory contents");
    // Create a javascript object representing the memory storing the machine code (see memory-structure.md for documentation on what this object holds)
    var memory = generateMemory(lines, symbolTable);
    // Format the memory for a cdm file
    var memoryFile = generateMemoryFile(memory);
    log("Checking memory");
    // Check for warnings and errors in the memory
    var memory = checkMemory(memory, symbolTable)

    // Finally, display results to the user
    showSymbolTable(symbolTable, symbolLineNums);
    showMemory(memory);
    showDownlaodButton(memoryFile);
    log("Done!");
}

// Create a map containing the labels and the addresses to which they refer and a map of which line in the source file each symbol is defined at (first pass)
function generateSymbolTable(lines) {
    var symbolTable = {};
    var symbolLineNums = {};
    var addrCounter = 0;
    for (var i = 0; i < lines.length; i++) {
        var line = lines[i];

        // Skip blank lines
        if (line == "") {
            continue;
        }

        if (line.toUpperCase().startsWith("END")) {
            break;
        }

        // If the line contains a comma, parse the label
        if (line.indexOf(",") != -1) {
            var label = line.substring(0,line.indexOf(","));
            if (label.indexOf(" ") != -1) {
                logErr("Label cannot contain spaces", i + 1);
                continue
            }
            symbolTable[label] = addrCounter;
            symbolLineNums[label] = i + 1;
        }

        addrCounter++;
        if (line.toUpperCase().startsWith("ORG")) {
            addrCounter = parseInt(line.substring(4), 16);
        }
    }
    return [symbolTable, symbolLineNums];
}

// Compute the contents of the memory (second pass)
function generateMemory(lines, symbolTable) {
    var memory = {};
    var addrCounter = 0;
    var ended = false;

    for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        
        // Skip blank lines
        if (line == "") {
            continue;
        }

        if (ended == true) {
            logWarning("Assembly file continues after END statement");
            break;
        }

        // If this line is and ORG pseudo-command, adjust the address counter
        if (line.toUpperCase().startsWith("ORG")) {
            addrCounter = parseInt(line.substring(4), 16);

            // Check if this ORG is at the beginning of the file, if so, add a BUN command at memory location 0
            if (memory[0] == null && addrCounter != 0) {
                memory[0] = instruction("BUN", [addrCounter.toString(16)], symbolTable, i + 1);
            }
        }
        // If it is the END pseudo-command, remember and move on to the next line (in case we need to show a warning about the program continuing past the END command)
        else if (line.toUpperCase().startsWith("END")) {
            ended = true;
            if (line.length > 3) {
                logWarning("END statment should have nothing following it");
            }
            continue;
        }
        // Otherwise, it is a normal instruction
        else {
            // Remove the label at the beginning of the line if it is present
            if (line.indexOf(",") != -1) {
                line = line.substring(line.indexOf(",") + 1).trim();

                // Skip blank lines
                if (line == "") {
                    continue;
                }
            }

            // Check to see if this will overwrite a memory location previously defined in the program
            if (memory[addrCounter] != null) {
                memory[addrCounter] = memoryObjectBuilders.error("This will overwrite the instruction at line " + memory[addrCounter]["sourceLine"] + " (both are at location " + addrCounter.toString(16).toUpperCase() + " in memory)", null, i + 1);
                break;
            }
            
            // Parse the opcode and operand(s)
            var words = line.split(" ");
            for (var j = 0; j < words.length; j++) {
                words[j] = words[j].trim();
                if (words[j] == "") {
                    words.splice(j, 1);
                    j--;
                }
            }
            var opcode = words[0].toUpperCase();
            var operands = words.slice(1);
            // If we have a handler for this opcode, use it
            if (opcode in opcodeHandlers) {
                memory[addrCounter] = instruction(opcode, operands, symbolTable, i + 1);
            } else {
                memory[addrCounter] = memoryObjectBuilders.error(opcode + " is not a valid instruction", opcode, i + 1);
            }
            
            addrCounter++;
        }
    }
    return memory;
}

// Check memory for additional warnings
function checkMemory(memory, symbolTable) {
    var halts = false;
    for (var memLocation in memory) {
        var memObject = memory[memLocation];

        // Don't check errored lines for warnings
        if (memObject.error != null) {
            continue;
        }

        // Get the operation type of surrounding memory locations
        var previousType = null;
        var secondPreviousType = null;
        var nextType = null;
        if ((memLocation - 2) in memory) {
            secondPreviousType = memory[memLocation - 2]["type"];
        }
        if ((memLocation - 1) in memory) {
            previousType = memory[memLocation - 1]["type"];
        }
        if ((memLocation + 1) in memory) {
            nextType = memory[memLocation + 1]["type"];
        }

        switch (memObject.type) {
            case "b": {
                // Make sure it branches to somewhere that is defined
                if (!memObject.instruction.indirect && memory[memObject.instruction.operand] == null) {
                    memory[memLocation] = memoryObjectBuilders.addWarning(memory[memLocation], "Branching to a memory location that is not defined")
                }
                // Ensure it does not branch to data
                if (!memObject.instruction.indirect && memory[memObject.instruction.operand] != null && memory[memObject.instruction.operand].type == "d") {
                    memory[memLocation] = memoryObjectBuilders.addWarning(memory[memLocation], "Branching to a memory location that contains data")
                }
            }
            case "s":
            case "i": {
                // ensure that the previous location is an instruction, second previous is a skip, or this one or previous one is labeled. If it isn't though, also make sure it's not following the initial bun that's added. Finally, ignore this if the previous insruction is branching may return
                if (!memLocInSymbolTable(memLocation, symbolTable) && !memLocInSymbolTable(memLocation - 1, symbolTable) && (previousType != "i" && previousType != "s") && (secondPreviousType != "s") && (memLocation != 0) && !((memory[0]["instruction"]["opcode"] == "BUN") && (memory[0]["instruction"]["operand"] == memLocation)) && previousType != "br") {
                    memory[memLocation] = memoryObjectBuilders.addWarning(memory[memLocation], "This instruction may never be executed (it isn't labeled and doesn't follow another instruction)");
                }
                // Ensure indirect references reference data
                if (memObject.instruction.indirect) {
                    if (memory[memObject.instruction.operand] == null) {
                        memory[memLocation] = memoryObjectBuilders.addWarning(memory[memLocation], "Indirect reference to an undefined location")
                    }
                    else if (memory[memObject.instruction.operand].type != "d") {
                        memory[memLocation] = memoryObjectBuilders.addWarning(memory[memLocation], "Indirect reference to an instruction")
                    }
                }
                break;
            }
            case "d": {
                if (previousType == "i") {
                    memory[memLocation] = memoryObjectBuilders.addWarning(memory[memLocation], "Data may be executed as instruction");
                }
                break;
            }
            case "h": {
                halts = true;
                break;
            }
        }
        if (memObject.instruction.opcode == "LDA" && !memObject.instruction.indirect && memory[memObject.instruction.operand] != null && memory[memObject.instruction.operand].type != "d") {
            memory[memLocation] = memoryObjectBuilders.addWarning(memory[memLocation], "This instruction may load another instruction into AC");
        }
    }
    if (!halts) {
        logWarning("Program never halts");
    }
    return memory;
}

function memLocInSymbolTable(memLoc, symbolTable) {
    for (var label in symbolTable) {
        if (symbolTable[label] == memLoc) {
            return true;
        }
    }
    return false;
}

// Generate the contents of a cedarlogic memory file from the memory object
function generateMemoryFile(memory) {
    var memoryFile = "";
    for (var memLocation in memory) {;
        // add extra new line when addresses skips
        if (! ((memLocation - 1) in memory) && memLocation != 0) {
            memoryFile += "\n";
        }
        if (!("error" in memory[memLocation])) {
            memoryFile += parseInt(memLocation).toString(16).toUpperCase();
            memoryFile += ":";
            memoryFile += memory[memLocation]["raw"].toString(16).toUpperCase().padStart(4, "0");
            memoryFile += "\n"
        }
    }
    return memoryFile;
}

// Generate the contents of a cedarlogic memory file with html formatting from the memory object
function showMemory(memory) {
    var newHTML = "";
    for (var memLocation in memory) {
        var memObject = memory[memLocation];
        // add extra new line when addresses skips
        if (! ((memLocation - 1) in memory) && memLocation != 0) {
            newHTML += "<tr><td></td></tr>";
        }
        if ("error" in memObject) {
            logErr(memObject["error"], memObject["sourceLine"]);
        } else {
            newHTML += "<tr id='memSourceLine" + memObject["sourceLine"] + "' onclick='goToLine(" + memObject["sourceLine"] + ")'><td><span class='memLocation'>" + parseInt(memLocation).toString(16).toUpperCase().padStart(3, "0") + "</span>";
            newHTML += ":";
            newHTML += "<span class='memContents'>" + memObject["raw"].toString(16).toUpperCase().padStart(4, "0") + "</span></td>";
            newHTML += "<td><span class='memOp'>[" + memObject["instruction"]["opcode"] + "]</span></td>";
            if ("warnings" in memObject) {
                newHTML += "<td><span class='warning'>Warning: </span>";
                setStatus(memoryOutStatus, STATUSES.STATUS_WARNING);
                for (var i = 0; i < memObject["warnings"].length; i++) {
                    newHTML += " <span class='warning'>" + memObject["warnings"][i];
                    if (i != memObject["warnings"].length - 1) {
                        newHTML +=  "; </span><br/>";
                    } else {
                        newHTML += ", </span>" 
                    }
                }
                newHTML += " <span class='lineNum'>line " + memObject["sourceLine"] + "</span></td>";
            } 
            newHTML += "</tr>"
        }
    }
    memoryOut.innerHTML = newHTML;
}

// display the symbol table in the interface
function showSymbolTable(symbolTable, symbolLineNums) {
    SymbolTableOut.innerHTML = "<tr><th>Label</th><th>Addres</th><th>Line</th></tr>"
    for (var symbol in symbolTable) {
        SymbolTableOut.innerHTML += "<tr><td>" + symbol + "</td><td class='code'>" + symbolTable[symbol].toString(16).toUpperCase() + "</td><td><span class='lineNum' onclick='goToLine(" + symbolLineNums[symbol] + ")'>" + symbolLineNums[symbol] + "</span></td></tr>";
    }
}

// Set up and show the button to download the cdm file
function showDownlaodButton(memoryFile) {
    downloadBtn.href = "data:text/plain;charset=utf-8," + encodeURIComponent(memoryFile);
    downloadBtn.download = projectName + ".cdm";
    downloadBtn.style.display = "inline";
}

// The operations that the machine can perform are defined here. The opcode is mapped to a function that takes the operands and symbol table and returns the memory contents that perform that operation
// This part is responsible for generating the contents of the memory and the operand
function instruction(opcode, operands, symbolTable, lineNum) {
    var memObject = opcodeHandlers[opcode] (operands, symbolTable);
    if (!("instruction" in memObject)) {
        memObject["instruction"] = {};
    }
    memObject["instruction"]["opcode"] = opcode;
    memObject["sourceLine"] = lineNum;
    return memObject;
}

// Functions take an opcode (with operands) and generate their part of the memory object associated with thatinstruction
var opcodeHandlers = {
    // Pseudo commands
    "DEC": (operands) => memoryObjectBuilders.number(operands, 10),
    "HEX": (operands) => memoryObjectBuilders.number(operands, 16),

    // Memory reference
    "AND": (operands, symbolTable) => memoryObjectBuilders.memReferenceOp(0x0000, operands, symbolTable),
    "ADD": (operands, symbolTable) => memoryObjectBuilders.memReferenceOp(0x1000, operands, symbolTable),
    "LDA": (operands, symbolTable) => memoryObjectBuilders.memReferenceOp(0x2000, operands, symbolTable),
    "STA": (operands, symbolTable) => memoryObjectBuilders.memReferenceOp(0x3000, operands, symbolTable),
    "BUN": (operands, symbolTable) => memoryObjectBuilders.memReferenceOp(0x4000, operands, symbolTable, "b"),
    "BSA": (operands, symbolTable) => memoryObjectBuilders.memReferenceOp(0x5000, operands, symbolTable, "br"),
    "ISZ": (operands, symbolTable) => memoryObjectBuilders.memReferenceOp(0x6000, operands, symbolTable, "s"),

    // Register reference
    "CLA": () => memoryObjectBuilders.raw(0x7800),
    "CLE": () => memoryObjectBuilders.raw(0x7400),
    "CMA": () => memoryObjectBuilders.raw(0x7200),
    "CME": () => memoryObjectBuilders.raw(0x7100),
    "CIR": () => memoryObjectBuilders.raw(0x7080),
    "CIL": () => memoryObjectBuilders.raw(0x7040),
    "INC": () => memoryObjectBuilders.raw(0x7020),
    "SPA": () => memoryObjectBuilders.raw(0x7010, "s"),
    "SNA": () => memoryObjectBuilders.raw(0x7008, "s"),
    "SZA": () => memoryObjectBuilders.raw(0x7004, "s"),
    "SZE": () => memoryObjectBuilders.raw(0x7002, "s"),
    "HLT": () => memoryObjectBuilders.raw(0x7001, "h"),

    // IO
    "INP": () => memoryObjectBuilders.raw(0xF800),
    "OUT": () => memoryObjectBuilders.raw(0xF400),
    "SKI": () => memoryObjectBuilders.raw(0xF200, "s"),
    "SKO": () => memoryObjectBuilders.raw(0xF100, "s"),
    "ION": () => memoryObjectBuilders.raw(0xF080),
    "IOF": () => memoryObjectBuilders.raw(0xF040),
}

// A collection of functions to build the memory objects for different types of instructions
var memoryObjectBuilders = {
    // Generate a memory object for an instruction that has no operands
    raw: function(machineCode, type="i") {
        return {"raw": machineCode, "type": type};
    },

    number: function(operands, base) {
        var number = parseInt(operands[0], base);
        console.log(number);

        // Validate number
        if (isNaN(number)) {
            memoryObject = this.error("Invalid number")
        }
        else if (isNumberValid(number, 16)) {
            memoryObject = this.raw(fitBits(number, 16), "d")
        } else {
            memoryObject = this.error(operands[0] + " is too large to fit in 16 bits");
        }
        if (operands.length > 1) {
            memoryObject = this.addWarning(memoryObject, "This pseudo-operation should only have one operand")
        }
        return memoryObject;
    },

    // Generate the memory object for memory reference instructions
    memReferenceOp: function(code, operands, symbolTable, type="i") {
        var expanded = expandMemLocation(operands[0], symbolTable);
        var indirect = (operands.length > 1) ? operands[1].toUpperCase() == "I" : false;
        var memObject = [];

        // Validate operands
        if (operands.length == 0) {
            return this.error("At least one operand is required");
        }
        if (expanded == -1) {
            return this.error("Attempted to use label " + operands[0] + " that does not exist");
        }
        if (!isNumberValid(expanded, 12)) {
            return this.error("The number " + expanded.toString(16).toUpperCase() + " cannot fit within 12 bits");
        }

        // generate memory object
        code += fitBits(parseInt(expanded), 12);
        if (indirect) {
            code+=0x8000;
        }
        memObject =  {"raw": code, 
            "instruction": {
                "operand": expanded,
                "indirect": indirect,
            },
            "type" : type,
        }
        if (expanded != operands[0]) {
            memObject["instruction"]["operandLabel"] = operands[0];
        }

        // Add warnings
        if (operands.length > 2) {
            memObject = this.addWarning(memObject, "This opcode requires at most 2 operands, " + operands.length + " were given");
        }
        if ((operands.length > 1) && (operands[1].toUpperCase() != "I")) {
            memObject = this.addWarning(memObject, "The second operand should either be \"I\" or not present");
        }
        return memObject;
    },

    error: function(error, opcode=null, lineNum=null) {
        var memObject = {"error": error};
        if (opcode != null) {
            if (!(instruction in memObject)) {
                memObject["instruction"] = {};
            }
            memObject["instruction"]["opcode"] = opcode
        }
        if (lineNum != null) {
            memObject.sourceLine = lineNum;
        }
        return memObject;
    },

    addWarning: function(memObject, warning) {
        if (!("warnings" in memObject)) {
            memObject["warnings"] = [];
        }
        memObject["warnings"].push(warning);
        return memObject;
    }
}

// This function takes memory locations and if they are in the form of a label, returns the numerical address associated with the label
function expandMemLocation(location, symbolTable) {
    // If it's just numbers, return an int version unless it is in the symbol table
    if (/^[0-9a-fA-F]+$/.test(location) && ! (location in symbolTable)) {
        return parseInt(location, 16)
    } 
    // Otherwise, look it up in the symbol table
    else {
        if (location in symbolTable) {
            return symbolTable[location];
        } else {
            return -1
        }
    }
}

// Fit the negative numbers to the appropriate number of bits by removing all the preceeding 1s.
// For example, translates -10 from "FFFF FFFF FFFF FFF6" to "0000 0000 0000 FFF6"
function fitBits(number, bits) {
    return (number & ((2 ** bits) - 1));
}

// Make sure the number fits within the specified number of bits
function isNumberValid(number, bits) {
    return ((number > (0 - (2**(bits)))) && (number < ((2**(bits)))));
}

// Used when use types a new name into the project name text box
function rename(e) {
    projectName = e.target.value;
    downloadBtn.download = projectName + ".cdm";
    downloadBtn.innerHTML = "<button>Download " + projectName + ".cdm</button>";
    downloadAssemblyBtn.download = projectName + ".asm";
    document.title = "Assembler: " + projectName;
}

function clearLogs() {
    logOut.innerHTML = "";
}

function log(message) {
    logOut.innerHTML += "<p class='log'>" + message + "</p>"
}

function logErr(message, lineNum) {
    setStatus(assemblerLogStatus, STATUSES.STATUS_ERROR);
    logOut.innerHTML += "<p class='err'>" + message + " <span class='lineNum' onclick='goToLine(" + lineNum + ")'>line " + lineNum + "</span></p>"
}

function logWarning(message) {
    setStatus(assemblerLogStatus, STATUSES.STATUS_WARNING);
    logOut.innerHTML += "<p class='warning'>Warning: " + message + "</p>"
}

function onDownloadBtnClick(event) {
    unsavedChanges = false;
}

function onLeave(event) {
    if (unsavedChanges) {
        event.preventDefault();
        event.returnValue = true;
    }
}

function onAssemblyChange(event) {
    downloadAssemblyBtn.href = "data:text/plain;charset=utf-8," + encodeURIComponent(editor.getValue());
    downloadAssemblyBtn.download = projectName + ".asm";
    unsavedChanges = true;
    assemble(editor.getValue());
}

// Highlight the line in the memory contents display that the cursor is on in the code editor
function onEditorCursorChange(event) {
    highlightMemLine(editor.selection.getCursor().row + 1);
}

function highlightMemLine(line) {
    clearMemLineHighlights();
    var element = document.getElementById("memSourceLine" + line);
    if (element != null) {
        element.classList.add("highlightedMemLine");
    }
}

function clearMemLineHighlights() {
    for (const element of document.getElementsByClassName("highlightedMemLine")) {
        element.classList.remove("highlightedMemLine");
    }
}

function setStatus(element, status) {
    element.innerHTML = status.char;
    element.className = status.class;
}

function goToLine(lineNum) {
    editor.gotoLine(lineNum);
    editor.focus();
}