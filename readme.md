A graphical assembler for mano machine (a very simple computer) machine code.

# Usage
Download the code and open index.html in a browser. Click the "Open file" button to load an existing assembly file, or start typing into the code editor in the top left section. When you're done, you can download the memory file to load in to CedarLogic with the "Download memory (.cdm)" button. If you made changes to the code, use the "Download assembly (.asm)" button to download the new code. Use the "Project name" text box to set the name of the files you download.

# Features
- GUI
    - Buttons to load and save assembly files and save cedarlogic memory files
    - Assembly editor with real-time assembling
    - Formatted memory display with the contents of memory locations as well as the their opcode and warnings
    - Formatted symbol table, including the line number each symbol was declared
    - Assembler log with assembly errors
- Error checking and feedback to user:
    - Label contains spaces
    - Multiple instructions defined in the assembly file would occupy the same memory address (ORG statements overlap)
    - Use of invalid instructions. Ex: `ADDD num`
    - Invalid numbers. Ex: `DEC XYZ`
    - Numbers too large to fit in 16 or 12 bits (depending on the context). Ex: `DEC 1000000`
    - Not enough operands
    - Use of a label that was not defined
- Warning checking and feedback to user:
    - Assembly program continues after END statement
    - Too many operands for some instructions (not implemented for register reference instructions)
    - Branching to a memory location with no contents
    - A line containing data (defined with DEC or HEX commands) that may be executed as instruction.
    - Instructions that may never be executed
    - Indirect references to locations that contain instructions or are not defined in program
    - Program never halts
    - Loading an instruction to AC

# About the code
index.html contains the layout, style.css contains the style information, and script.js contains the actual logic.

# Credits
The code editor uses ace [[https://ace.c9.io]]. The ace-min directory in this repository is taken straight from [[https://github.com/ajaxorg/ace-builds]].