The memory object contains not only the raw memory for the mano machine but also information on what commands are in which memory location and their lines in the source code
Structure:
```json
{
    <int: address>:{
        "raw":<int: raw memory contents>, 
        "instruction": {
            "opcode": <string: opcode>,
            "operand": <int: operand if operand is present>,
            "operandLabel": <string: label if operand is a memory address>,
            "indirect": <boolean: true if indirect>
        },
        "sourceLine":<int: line number assembly file>,
        "error": <string: error in assembling line if one occured>,
        "warnings": <list: string: warning in assembling line if one occured>,
        "type": <string: i|d|b|br|s|h, indicates whether this location stores an instruction, data, branching, skip instruction or a halt (br indicates execution may return)>
    }
}
```