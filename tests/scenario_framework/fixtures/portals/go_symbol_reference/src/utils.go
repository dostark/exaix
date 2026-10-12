package src

// Point represents a 2D coordinate.
type Point struct {
	X float64
	Y float64
}

// tripleLocal triples a coordinate. Its name is unique in the portal, so a
// reference to Double can never be confused with it.
func tripleLocal(v float64) float64 {
	return v * 3
}

// Triple exposes the local tripling helper.
func Triple(v float64) float64 {
	return tripleLocal(v)
}
