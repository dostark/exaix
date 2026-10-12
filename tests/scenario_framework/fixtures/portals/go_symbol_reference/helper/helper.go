package helper

// Point mirrors the portal point so a cross-file edge is resolvable.
type Point struct {
	X float64
	Y float64
}

// Offset shifts every doubled coordinate.
const Offset = 7.0

// Double returns a point with doubled coordinates.
func Double(p Point) Point {
	return Point{X: p.X * 2, Y: p.Y * 2}
}
