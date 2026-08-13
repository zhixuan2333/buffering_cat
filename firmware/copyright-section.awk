{
	print
}

/_einit =/ {
	after_init = 1
	next
}

after_init && /^  } >FLASH/ {
	print "  .copyright :"
	print "  {"
	print "   KEEP(*(.copyright))"
	print "   . = ALIGN(4);"
	print "  } >FLASH AT>FLASH"
	after_init = 0
}
