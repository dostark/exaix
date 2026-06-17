package main

// Point represents a 2D coordinate.
type Point struct {
	X float64
	Y float64
}

// Shape defines a geometric shape.
type Shape interface {
	Area() float64
}

// NewPoint creates a new Point.
func NewPoint(x, y float64) Point {
	return Point{X: x, Y: y}
}

// MaxCoord is the maximum coordinate value.
const MaxCoord = 1000.0

// MyInt is a type alias for int.
type MyInt int
