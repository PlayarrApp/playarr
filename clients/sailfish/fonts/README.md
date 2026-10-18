Static instances of the shared Nunito Sans variable font (docs/parity/fonts/NunitoSans-wght-web.ttf) at the weights the
web phone layout uses (400 body headings, 580 headings, 610 card labels, 820 count lines). Qt 5.6 only draws a variable font's default
weight, so each weight is a separate file. Regenerate with fonttools:
`fonttools varLib.instancer NunitoSans-wght-web.ttf wght=580 -o NunitoSans-580.ttf`, then rename the family to "Nunito Sans W580" (name IDs 1, 4, 6, 16) and set the weight class to 400 so Qt keeps the three files apart. Licence: OFL-NunitoSans.txt.
